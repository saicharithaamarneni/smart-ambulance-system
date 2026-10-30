import { Router, Response } from 'express';
import { Trip, VALID_STATUS_TRANSITIONS, TripStatus } from '../models/Trip';
import { Booking } from '../models/Booking';
import { Ambulance } from '../models/Ambulance';
import { authenticate, authorize, AuthenticatedRequest } from '../middleware/auth';
import { asyncHandler, createError } from '../middleware/errorHandler';
import { createNotification } from '../services/notificationService';
import { AuditLog } from '../models/AuditLog';
import { Feedback } from '../models/Feedback';
import { io } from '../server';

const router = Router();

// GET /api/trips — Get trips for the authenticated user
router.get(
  '/',
  authenticate,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { role, id } = req.user!;
    const { status, page = '1', limit = '10' } = req.query;

    let query: any = {};
    if (role === 'patient') query.patient = id;
    else if (role === 'driver') query.driver = id;

    if (status) query.currentStatus = status;

    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);

    const [trips, total] = await Promise.all([
      Trip.find(query)
        .populate('patient', 'name phone bloodGroup')
        .populate('driver', 'name phone')
        .populate('ambulance', 'vehicleNumber type')
        .populate('hospital', 'name address')
        .populate('booking', 'bookingId emergencyCategory priority')
        .sort({ createdAt: -1 })
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum),
      Trip.countDocuments(query),
    ]);

    res.json({
      success: true,
      data: {
        trips,
        pagination: { total, page: pageNum, limit: limitNum, pages: Math.ceil(total / limitNum) },
      },
    });
  })
);

// GET /api/trips/active — Get active trip for driver
router.get(
  '/active',
  authenticate,
  authorize('driver'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const trip = await Trip.findOne({
      driver: req.user!.id,
      currentStatus: { $nin: ['completed'] },
    })
      .populate('patient', 'name phone bloodGroup emergencyContact')
      .populate('ambulance', 'vehicleNumber type capabilities')
      .populate('hospital', 'name address phone location')
      .populate('booking', 'bookingId emergencyCategory emergencyDescription priority dispatchScores');

    res.json({ success: true, data: { trip } });
  })
);

// GET /api/trips/:tripId — Get specific trip
router.get(
  '/:tripId',
  authenticate,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { tripId } = req.params;
    const { role, id } = req.user!;

    const trip = await Trip.findOne({ tripId })
      .populate('patient', 'name phone email bloodGroup emergencyContact medicalHistory')
      .populate('driver', 'name phone')
      .populate('ambulance', 'vehicleNumber type capabilities equipment')
      .populate('hospital', 'name address phone location specialties')
      .populate('booking', 'bookingId emergencyCategory emergencyDescription priority dispatchScores selectedHospitalReason');

    if (!trip) throw createError('Trip not found', 404);

    // Auth check: patient/driver can only see their own trips
    if (role === 'patient' && trip.patient._id.toString() !== id) {
      throw createError('Access denied to this trip', 403);
    }
    if (role === 'driver' && trip.driver._id.toString() !== id) {
      throw createError('Access denied to this trip', 403);
    }

    res.json({ success: true, data: { trip } });
  })
);

// PUT /api/trips/:tripId/status — Update trip status (drivers only)
router.put(
  '/:tripId/status',
  authenticate,
  authorize('driver', 'admin'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { tripId } = req.params;
    const { status, note, location } = req.body;
    const { id, role } = req.user!;

    if (!status) throw createError('Status is required', 400);

    const trip = await Trip.findOne({ tripId })
      .populate('patient')
      .populate('ambulance');

    if (!trip) throw createError('Trip not found', 404);

    // Only the assigned driver or admin can update status
    if (role === 'driver' && trip.driver.toString() !== id) {
      throw createError('Not authorized to update this trip', 403);
    }

    const currentStatus = trip.currentStatus as TripStatus;
    const newStatus = status as TripStatus;

    // Validate status transition
    const validNextStatuses = VALID_STATUS_TRANSITIONS[currentStatus];
    if (!validNextStatuses || !validNextStatuses.includes(newStatus)) {
      throw createError(
        `Invalid status transition: ${currentStatus} → ${newStatus}. Valid transitions: ${validNextStatuses?.join(', ') || 'none (trip completed)'}`,
        400
      );
    }

    const now = new Date();
    const updateData: any = {
      currentStatus: newStatus,
      $push: {
        statusHistory: {
          status: newStatus,
          timestamp: now,
          location,
          note: note || `Status updated to ${newStatus}`,
          updatedBy: id,
        },
      },
    };

    // Update timestamps based on status
    if (newStatus === 'en_route_to_pickup') updateData.startedAt = now;
    if (newStatus === 'completed') {
      updateData.completedAt = now;
      if (trip.startedAt) {
        updateData.actualDurationMinutes = Math.round((now.getTime() - trip.startedAt.getTime()) / 60000);
      }
    }

    await Trip.findByIdAndUpdate(trip._id, updateData);

    // Update booking status
    const bookingStatusMap: Record<TripStatus, string> = {
      assigned: 'assigned',
      accepted: 'accepted',
      en_route_to_pickup: 'en_route_to_pickup',
      arrived_at_pickup: 'arrived_at_pickup',
      patient_onboard: 'patient_onboard',
      en_route_to_hospital: 'en_route_to_hospital',
      arrived_at_hospital: 'arrived_at_hospital',
      completed: 'completed',
    };

    const bookingUpdateData: any = { status: bookingStatusMap[newStatus] };
    if (newStatus === 'arrived_at_pickup') bookingUpdateData.actualPickupTime = now;
    if (newStatus === 'arrived_at_hospital') bookingUpdateData.actualHospitalArrivalTime = now;
    if (newStatus === 'completed') {
      bookingUpdateData.completionTime = now;
      // Release ambulance
      await Ambulance.findByIdAndUpdate(trip.ambulance, {
        status: 'available',
        currentBooking: null,
      });
    }

    await Booking.findByIdAndUpdate(trip.booking, bookingUpdateData);

    // Emit real-time update
    const patientId = trip.patient._id?.toString() || trip.patient.toString();
    io.to(`patient_${patientId}`).emit('trip_status_update', {
      tripId,
      status: newStatus,
      timestamp: now,
      location,
    });
    io.to('admin_room').emit('trip_status_update', {
      tripId,
      status: newStatus,
      driverId: id,
    });

    // Send appropriate notifications
    const notificationMessages: Partial<Record<TripStatus, { title: string; message: string; type: string }>> = {
      en_route_to_pickup: {
        type: 'driver_en_route',
        title: 'Driver En Route',
        message: 'Your ambulance is on the way to your location.',
      },
      arrived_at_pickup: {
        type: 'ambulance_arrived',
        title: 'Ambulance Arrived',
        message: 'Your ambulance has arrived at your location.',
      },
      patient_onboard: {
        type: 'patient_onboard',
        title: 'Patient Onboard',
        message: 'You are now in the ambulance heading to the hospital.',
      },
      arrived_at_hospital: {
        type: 'hospital_selected',
        title: 'Arrived at Hospital',
        message: 'You have arrived at the hospital. Emergency staff have been notified.',
      },
      completed: {
        type: 'trip_completed',
        title: 'Trip Completed',
        message: 'Your emergency trip has been completed. Please rate your experience.',
      },
    };

    const notif = notificationMessages[newStatus];
    if (notif) {
      await createNotification({
        recipientId: patientId,
        type: notif.type as any,
        title: notif.title,
        message: notif.message,
        relatedTripId: trip._id.toString(),
      });
    }

    await AuditLog.create({
      actor: id,
      actorRole: role,
      action: 'TRIP_STATUS_UPDATED',
      targetModel: 'Trip',
      targetId: trip._id,
      details: { tripId, from: currentStatus, to: newStatus },
    }).catch(() => {});

    res.json({
      success: true,
      message: `Trip status updated to ${newStatus}`,
      data: { tripId, currentStatus: newStatus },
    });
  })
);

// POST /api/trips/:tripId/feedback — Submit feedback
router.post(
  '/:tripId/feedback',
  authenticate,
  authorize('patient'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { tripId } = req.params;
    const { overallRating, driverRating, hospitalRating, responseTimeRating, comment, tags } = req.body;

    const trip = await Trip.findOne({ tripId });
    if (!trip) throw createError('Trip not found', 404);

    if (trip.patient.toString() !== req.user!.id) {
      throw createError('Not authorized to submit feedback for this trip', 403);
    }
    if (trip.currentStatus !== 'completed') {
      throw createError('Can only submit feedback for completed trips', 400);
    }

    // Check if feedback already submitted
    const existingFeedback = await Feedback.findOne({ booking: trip.booking });
    if (existingFeedback) {
      throw createError('Feedback already submitted for this booking', 409);
    }

    const feedback = await Feedback.create({
      booking: trip.booking,
      patient: req.user!.id,
      driver: trip.driver,
      hospital: trip.hospital,
      overallRating,
      driverRating,
      hospitalRating,
      responseTimeRating,
      comment,
      tags,
    });

    await Booking.findByIdAndUpdate(trip.booking, { feedback: feedback._id });

    res.status(201).json({ success: true, message: 'Feedback submitted. Thank you!', data: { feedback } });
  })
);

export default router;
