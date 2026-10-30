import mongoose from 'mongoose';
import { Ambulance, IAmbulance } from '../models/Ambulance';
import { Booking, IBooking, IDispatchScore } from '../models/Booking';
import { Trip } from '../models/Trip';
import { Notification } from '../models/Notification';
import { AuditLog } from '../models/AuditLog';
import { io } from '../server';
import { logger } from '../utils/logger';
import { calculateDistance, calculateETA } from '../utils/geoUtils';
import { createNotification } from './notificationService';
import { v4 as uuidv4 } from 'uuid';

const DRIVER_RESPONSE_TIMEOUT_MS = 30000; // 30 seconds
const MAX_ASSIGNMENT_ATTEMPTS = 3;
const STALE_LOCATION_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes

// Ambulance type capability hierarchy
const AMBULANCE_CAPABILITY_SCORES: Record<string, number> = {
  BLS: 1,
  ALS: 2,
  CCT: 3,
  NICU: 3,
  BARIATRIC: 2,
};

// Emergency category to required capability mapping
const EMERGENCY_CAPABILITY_MAP: Record<string, string[]> = {
  cardiac_arrest: ['ALS', 'CCT'],
  stroke: ['ALS', 'CCT'],
  trauma: ['ALS', 'CCT', 'BLS'],
  respiratory: ['ALS', 'CCT'],
  obstetric: ['ALS', 'CCT'],
  pediatric: ['NICU', 'ALS', 'CCT'],
  burns: ['ALS', 'CCT'],
  poisoning: ['ALS', 'BLS'],
  diabetic: ['BLS', 'ALS'],
  psychiatric: ['BLS', 'ALS'],
  other: ['BLS', 'ALS', 'CCT'],
};

interface DispatchResult {
  success: boolean;
  ambulance?: IAmbulance;
  bookingId: string;
  score?: IDispatchScore;
  message: string;
}

/**
 * Main dispatch engine — finds the best available ambulance and assigns it.
 * Uses scoring based on distance, ETA, capability match, and location freshness.
 */
export async function dispatchAmbulance(bookingId: string): Promise<DispatchResult> {
  const booking = await Booking.findOne({ bookingId }).populate('patient');
  if (!booking) {
    return { success: false, bookingId, message: 'Booking not found' };
  }

  if (booking.assignmentAttempts.length >= MAX_ASSIGNMENT_ATTEMPTS) {
    await Booking.findByIdAndUpdate(booking._id, { status: 'no_ambulance_available' });
    await createNotification({
      recipientId: booking.patient.toString(),
      type: 'no_ambulance_available',
      title: 'No Ambulance Available',
      message: 'We were unable to assign an ambulance after multiple attempts. Please call emergency services directly.',
      relatedBookingId: booking._id.toString(),
    });
    io.to(`patient_${booking.patient}`).emit('booking_status', {
      bookingId,
      status: 'no_ambulance_available',
      message: 'No ambulance available. Please call 108 immediately.',
    });
    return { success: false, bookingId, message: 'No ambulance available after maximum attempts' };
  }

  // Update booking to dispatching
  await Booking.findByIdAndUpdate(booking._id, { status: 'dispatching' });

  // Get all available ambulances
  const availableAmbulances = await Ambulance.find({
    status: 'available',
    isOnline: true,
    driver: { $exists: true, $ne: null },
  }).populate('driver');

  if (availableAmbulances.length === 0) {
    await Booking.findByIdAndUpdate(booking._id, { status: 'no_ambulance_available' });
    await createNotification({
      recipientId: booking.patient.toString(),
      type: 'no_ambulance_available',
      title: 'No Ambulances Available',
      message: 'All ambulances are currently busy. Please contact emergency services at 108.',
      relatedBookingId: booking._id.toString(),
    });
    return { success: false, bookingId, message: 'No available ambulances' };
  }

  // Filter by required capability
  const requiredTypes = booking.emergencyCategory
    ? EMERGENCY_CAPABILITY_MAP[booking.emergencyCategory] || EMERGENCY_CAPABILITY_MAP['other']
    : EMERGENCY_CAPABILITY_MAP['other'];

  const requiredAmbulanceType = booking.requiredAmbulanceType;
  let eligibleAmbulances = availableAmbulances.filter((amb) => {
    // If patient specified a type, strictly filter
    if (requiredAmbulanceType) {
      return amb.type === requiredAmbulanceType;
    }
    // Otherwise filter by capability for emergency category
    return requiredTypes.includes(amb.type);
  });

  // Fallback: if no eligible ambulances match capability, use any available
  if (eligibleAmbulances.length === 0) {
    logger.warn(`No capability-matched ambulances for ${booking.emergencyCategory}. Using any available.`);
    eligibleAmbulances = availableAmbulances;
  }

  // Filter out ambulances with stale GPS location
  const freshAmbulances = eligibleAmbulances.filter((amb) => {
    if (!amb.currentLocation || !amb.lastLocationUpdate) return false;
    const age = Date.now() - amb.lastLocationUpdate.getTime();
    return age <= STALE_LOCATION_THRESHOLD_MS;
  });

  // If no fresh ambulances, include stale ones but penalize them
  const candidateAmbulances = freshAmbulances.length > 0 ? freshAmbulances : eligibleAmbulances;

  // Skip ambulances already attempted in this booking
  const attemptedIds = booking.assignmentAttempts.map((a) => a.ambulanceId.toString());
  const finalCandidates = candidateAmbulances.filter(
    (amb) => !attemptedIds.includes(amb._id.toString())
  );

  if (finalCandidates.length === 0) {
    await Booking.findByIdAndUpdate(booking._id, { status: 'no_ambulance_available' });
    return { success: false, bookingId, message: 'All eligible ambulances have been tried' };
  }

  // Score all candidates
  const scores: IDispatchScore[] = finalCandidates.map((amb) => {
    return scoreAmbulance(amb, booking);
  });

  // Sort by score descending (higher = better)
  scores.sort((a, b) => b.score - a.score);

  const bestScore = scores[0];
  const bestAmbulance = finalCandidates.find(
    (a) => a._id.toString() === bestScore.ambulanceId.toString()
  )!;

  logger.info(`[DISPATCH] Assigning ${bestAmbulance.vehicleNumber} to booking ${bookingId}`);
  logger.info(`[DISPATCH] Score: ${bestScore.score.toFixed(2)}, ETA: ${bestScore.etaMinutes} min, Distance: ${bestScore.distanceKm} km`);
  logger.info(`[DISPATCH] Reasons: ${bestScore.reasons.join('; ')}`);

  // Atomically reserve the ambulance
  const reserved = await Ambulance.findOneAndUpdate(
    { _id: bestAmbulance._id, status: 'available' },
    { status: 'assigned', currentBooking: booking._id },
    { new: true }
  );

  if (!reserved) {
    // Race condition: ambulance was taken by another booking
    logger.warn(`[DISPATCH] Race condition: ambulance ${bestAmbulance.vehicleNumber} was taken. Retrying...`);
    return dispatchAmbulance(bookingId); // Retry with next best
  }

  // Update booking with assignment
  const assignmentStart = Date.now();
  await Booking.findByIdAndUpdate(booking._id, {
    status: 'assigned',
    ambulance: bestAmbulance._id,
    driver: bestAmbulance.driver,
    estimatedArrivalTime: new Date(Date.now() + bestScore.etaMinutes * 60 * 1000),
    requestToAssignmentTime: Math.round((Date.now() - booking.createdAt.getTime()) / 1000),
    $push: { dispatchScores: { $each: scores } },
  });

  // Create the trip record
  const tripId = `TRIP-${Date.now()}-${uuidv4().substring(0, 6).toUpperCase()}`;
  const trip = await Trip.create({
    tripId,
    booking: booking._id,
    patient: booking.patient,
    driver: bestAmbulance.driver,
    ambulance: bestAmbulance._id,
    currentStatus: 'assigned',
    statusHistory: [
      {
        status: 'assigned',
        timestamp: new Date(),
        updatedBy: bestAmbulance.driver,
        note: `Assigned via dispatch engine. Score: ${bestScore.score.toFixed(2)}`,
      },
    ],
    pickupLocation: booking.pickupLocation,
    distanceKm: bestScore.distanceKm,
    estimatedDurationMinutes: bestScore.etaMinutes,
  });

  // Notify driver via Socket.IO
  const driverId = bestAmbulance.driver?.toString();
  if (driverId) {
    io.to(`driver_${driverId}`).emit('new_booking_request', {
      bookingId,
      tripId,
      patient: {
        location: booking.pickupLocation,
        emergencyCategory: booking.emergencyCategory,
        emergencyDescription: booking.emergencyDescription,
        priority: booking.priority,
      },
      estimatedDistance: bestScore.distanceKm,
      estimatedETA: bestScore.etaMinutes,
      timeoutSeconds: DRIVER_RESPONSE_TIMEOUT_MS / 1000,
    });

    await createNotification({
      recipientId: driverId,
      type: 'ambulance_assigned',
      title: 'New Emergency Request',
      message: `Emergency booking ${bookingId}. Patient location: ${booking.pickupLocation.address}. ETA: ${bestScore.etaMinutes} min`,
      relatedBookingId: booking._id.toString(),
    });
  }

  // Notify patient
  io.to(`patient_${booking.patient}`).emit('booking_status', {
    bookingId,
    status: 'assigned',
    ambulance: {
      vehicleNumber: bestAmbulance.vehicleNumber,
      type: bestAmbulance.type,
    },
    estimatedArrival: bestScore.etaMinutes,
    dispatchReasons: bestScore.reasons,
    tripId,
  });

  await createNotification({
    recipientId: booking.patient.toString(),
    type: 'ambulance_assigned',
    title: 'Ambulance Assigned',
    message: `Ambulance ${bestAmbulance.vehicleNumber} has been assigned to your emergency. ETA: ${bestScore.etaMinutes} minutes.`,
    relatedBookingId: booking._id.toString(),
  });

  // Notify admins
  io.to('admin_room').emit('fleet_update', {
    type: 'assignment',
    bookingId,
    ambulanceId: bestAmbulance._id,
    vehicleNumber: bestAmbulance.vehicleNumber,
    dispatchReasons: bestScore.reasons,
    score: bestScore.score,
  });

  // Set driver response timeout
  setTimeout(async () => {
    await handleDriverTimeout(bookingId, bestAmbulance._id.toString(), driverId || '');
  }, DRIVER_RESPONSE_TIMEOUT_MS);

  // Audit log
  await AuditLog.create({
    actor: booking.patient,
    actorRole: 'system',
    action: 'AMBULANCE_DISPATCHED',
    targetModel: 'Booking',
    targetId: booking._id,
    details: {
      ambulanceId: bestAmbulance._id,
      vehicleNumber: bestAmbulance.vehicleNumber,
      distanceKm: bestScore.distanceKm,
      etaMinutes: bestScore.etaMinutes,
      score: bestScore.score,
      reasons: bestScore.reasons,
    },
  });

  return {
    success: true,
    ambulance: bestAmbulance,
    bookingId,
    score: bestScore,
    message: `Ambulance ${bestAmbulance.vehicleNumber} dispatched. ETA: ${bestScore.etaMinutes} min`,
  };
}

/**
 * Score an ambulance for suitability. Higher = better.
 * Factors: distance (closer = better), ETA, capability match, location freshness.
 */
function scoreAmbulance(ambulance: IAmbulance, booking: IBooking): IDispatchScore {
  const reasons: string[] = [];
  let score = 100; // Start at 100, subtract penalties / add bonuses

  const pickupLat = booking.pickupLocation.lat;
  const pickupLng = booking.pickupLocation.lng;

  let distanceKm = 999;
  let etaMinutes = 60;

  if (ambulance.currentLocation) {
    distanceKm = calculateDistance(
      ambulance.currentLocation.lat,
      ambulance.currentLocation.lng,
      pickupLat,
      pickupLng
    );
    etaMinutes = calculateETA(distanceKm, ambulance.type);
  }

  // Distance penalty: -5 points per km
  const distancePenalty = Math.min(distanceKm * 5, 80);
  score -= distancePenalty;
  reasons.push(`Distance: ${distanceKm.toFixed(1)} km (-${distancePenalty.toFixed(0)} pts)`);

  // ETA bonus/penalty
  if (etaMinutes <= 5) {
    score += 20;
    reasons.push('Excellent ETA: under 5 min (+20 pts)');
  } else if (etaMinutes <= 10) {
    score += 10;
    reasons.push('Good ETA: under 10 min (+10 pts)');
  } else if (etaMinutes > 20) {
    score -= 15;
    reasons.push(`High ETA: ${etaMinutes} min (-15 pts)`);
  }

  // Capability match bonus
  const capScore = AMBULANCE_CAPABILITY_SCORES[ambulance.type] || 1;
  score += capScore * 5;
  reasons.push(`Capability ${ambulance.type} (score ${capScore}) +${capScore * 5} pts`);

  // Location freshness
  if (ambulance.lastLocationUpdate) {
    const ageMs = Date.now() - ambulance.lastLocationUpdate.getTime();
    const ageMinutes = ageMs / 60000;
    if (ageMinutes > 10) {
      const stalePenalty = Math.min(ageMinutes * 2, 30);
      score -= stalePenalty;
      reasons.push(`Stale GPS: ${ageMinutes.toFixed(0)} min old (-${stalePenalty.toFixed(0)} pts)`);
    } else {
      score += 5;
      reasons.push('Fresh GPS location (+5 pts)');
    }
  } else {
    score -= 40;
    reasons.push('No GPS location known (-40 pts)');
  }

  // Simulated location penalty (slight)
  if (ambulance.isSimulated) {
    reasons.push('[SIMULATED GPS]');
  }

  return {
    ambulanceId: ambulance._id,
    vehicleNumber: ambulance.vehicleNumber,
    distanceKm: parseFloat(distanceKm.toFixed(2)),
    etaMinutes: Math.ceil(etaMinutes),
    score: parseFloat(score.toFixed(2)),
    reasons,
  };
}

/**
 * Handle driver response timeout — release ambulance and retry dispatch.
 */
async function handleDriverTimeout(
  bookingId: string,
  ambulanceId: string,
  driverId: string
): Promise<void> {
  const booking = await Booking.findOne({ bookingId });
  if (!booking || !['assigned', 'dispatching'].includes(booking.status)) {
    return; // Driver already responded
  }

  logger.warn(`[DISPATCH] Driver timeout for booking ${bookingId}`);

  // Release ambulance
  await Ambulance.findByIdAndUpdate(ambulanceId, {
    status: 'available',
    currentBooking: null,
  });

  // Record timeout in booking
  await Booking.findByIdAndUpdate(booking._id, {
    $push: {
      assignmentAttempts: {
        ambulanceId: new mongoose.Types.ObjectId(ambulanceId),
        driverId: new mongoose.Types.ObjectId(driverId),
        attemptedAt: new Date(),
        result: 'timeout',
        reason: 'Driver did not respond within timeout period',
        responseTime: DRIVER_RESPONSE_TIMEOUT_MS / 1000,
      },
    },
    status: 'pending', // Reset to pending for retry
    ambulance: null,
    driver: null,
  });

  // Notify patient
  io.to(`patient_${booking.patient}`).emit('booking_status', {
    bookingId,
    status: 'retrying',
    message: 'Driver did not respond. Finding another ambulance...',
  });

  // Retry dispatch
  setTimeout(() => {
    dispatchAmbulance(bookingId);
  }, 2000);
}

/**
 * Handle driver response (accept/reject)
 */
export async function handleDriverResponse(
  bookingId: string,
  driverId: string,
  accepted: boolean,
  reason?: string
): Promise<{ success: boolean; message: string }> {
  const booking = await Booking.findOne({ bookingId });
  if (!booking) {
    return { success: false, message: 'Booking not found' };
  }

  if (!['assigned', 'dispatching'].includes(booking.status)) {
    return { success: false, message: 'Booking is no longer in assigned state' };
  }

  const responseTime = Math.round((Date.now() - booking.updatedAt.getTime()) / 1000);

  if (accepted) {
    // Update booking status
    await Booking.findByIdAndUpdate(booking._id, {
      status: 'accepted',
      assignmentToAcceptanceTime: responseTime,
      $push: {
        assignmentAttempts: {
          ambulanceId: booking.ambulance,
          driverId: new mongoose.Types.ObjectId(driverId),
          attemptedAt: new Date(),
          result: 'accepted',
          responseTime,
        },
      },
    });

    // Update trip status
    await Trip.findOneAndUpdate(
      { booking: booking._id },
      {
        currentStatus: 'accepted',
        startedAt: new Date(),
        $push: {
          statusHistory: {
            status: 'accepted',
            timestamp: new Date(),
            updatedBy: new mongoose.Types.ObjectId(driverId),
            note: 'Driver accepted the request',
          },
        },
      }
    );

    // Notify patient
    io.to(`patient_${booking.patient}`).emit('booking_status', {
      bookingId,
      status: 'accepted',
      message: 'Driver has accepted your request and is on the way!',
    });

    await createNotification({
      recipientId: booking.patient.toString(),
      type: 'driver_accepted',
      title: 'Driver Accepted',
      message: 'Your ambulance driver has accepted the request and is heading to your location.',
      relatedBookingId: booking._id.toString(),
    });

    return { success: true, message: 'Request accepted' };
  } else {
    // Driver rejected
    const ambulanceId = booking.ambulance?.toString();
    if (ambulanceId) {
      await Ambulance.findByIdAndUpdate(ambulanceId, {
        status: 'available',
        currentBooking: null,
      });
    }

    await Booking.findByIdAndUpdate(booking._id, {
      status: 'pending',
      ambulance: null,
      driver: null,
      $push: {
        assignmentAttempts: {
          ambulanceId: booking.ambulance,
          driverId: new mongoose.Types.ObjectId(driverId),
          attemptedAt: new Date(),
          result: 'rejected',
          reason: reason || 'Driver rejected',
          responseTime,
        },
      },
    });

    // Notify patient
    io.to(`patient_${booking.patient}`).emit('booking_status', {
      bookingId,
      status: 'retrying',
      message: 'Finding another ambulance for you...',
    });

    await createNotification({
      recipientId: booking.patient.toString(),
      type: 'driver_rejected',
      title: 'Finding Another Ambulance',
      message: 'Your previous driver was unavailable. We are finding another ambulance for you.',
      relatedBookingId: booking._id.toString(),
    });

    // Retry dispatch after short delay
    setTimeout(() => {
      dispatchAmbulance(bookingId);
    }, 2000);

    return { success: true, message: 'Request rejected, finding alternative' };
  }
}
