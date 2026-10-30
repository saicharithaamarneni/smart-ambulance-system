import { Router, Response } from 'express';
import { z } from 'zod';
import { Booking, IBooking } from '../models/Booking';
import { authenticate, authorize, AuthenticatedRequest } from '../middleware/auth';
import { asyncHandler, createError } from '../middleware/errorHandler';
import { dispatchAmbulance } from '../services/dispatchService';
import { recommendHospitals } from '../services/hospitalService';
import { createNotification } from '../services/notificationService';
import { Ambulance } from '../models/Ambulance';
import { Trip } from '../models/Trip';
import { AuditLog } from '../models/AuditLog';
import { io } from '../server';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

const CreateBookingSchema = z.object({
  emergencyCategory: z.enum([
    'cardiac_arrest', 'stroke', 'trauma', 'respiratory',
    'obstetric', 'pediatric', 'burns', 'poisoning',
    'diabetic', 'psychiatric', 'other'
  ]),
  emergencyDescription: z.string().min(10).max(1000),
  pickupLocation: z.object({
    address: z.string().min(5),
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    landmark: z.string().optional(),
  }),
  requiredAmbulanceType: z.string().optional(),
  requiredCapabilities: z.array(z.string()).optional(),
  patientCondition: z.string().optional(),
  numberOfPatients: z.number().min(1).max(10).optional(),
  priority: z.enum(['critical', 'high', 'medium', 'low']).optional(),
});

// POST /api/bookings — Create SOS booking
router.post(
  '/',
  authenticate,
  authorize('patient'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const validated = CreateBookingSchema.safeParse(req.body);
    if (!validated.success) {
      throw createError(validated.error.errors.map((e) => e.message).join(', '), 400);
    }

    const data = validated.data;
    const patientId = req.user!.id;

    // Prevent duplicate active bookings
    const activeBooking = await Booking.findOne({
      patient: patientId,
      status: { $nin: ['completed', 'cancelled', 'failed', 'no_ambulance_available'] },
    });
    if (activeBooking) {
      throw createError(
        `You already have an active booking (${activeBooking.bookingId}). Please wait for it to complete or cancel it first.`,
        409
      );
    }

    const bookingId = `SOS-${Date.now()}-${uuidv4().substring(0, 6).toUpperCase()}`;

    const booking = await Booking.create({
      bookingId,
      patient: patientId,
      ...data,
      status: 'pending',
      requiredCapabilities: data.requiredCapabilities || [],
    });

    // Notify patient
    await createNotification({
      recipientId: patientId,
      type: 'booking_created',
      title: 'Emergency Booking Created',
      message: `Your SOS booking ${bookingId} has been received. Dispatching nearest ambulance...`,
      relatedBookingId: booking._id.toString(),
    });

    // Notify admins
    io.to('admin_room').emit('new_booking', {
      bookingId,
      emergencyCategory: data.emergencyCategory,
      priority: data.priority || 'high',
      location: data.pickupLocation,
      patientId,
    });

    // Audit log
    await AuditLog.create({
      actor: patientId,
      actorRole: 'patient',
      action: 'BOOKING_CREATED',
      targetModel: 'Booking',
      targetId: booking._id,
      details: { bookingId, emergencyCategory: data.emergencyCategory },
      ipAddress: req.ip,
    }).catch(() => {});

    // Trigger dispatch asynchronously
    setImmediate(() => {
      dispatchAmbulance(bookingId).catch((err) => {
        console.error('Dispatch error:', err);
      });
    });

    res.status(201).json({
      success: true,
      message: 'SOS booking created. Dispatching ambulance...',
      data: {
        bookingId,
        booking: booking,
      },
    });
  })
);

// GET /api/bookings — Get bookings (role-filtered)
router.get(
  '/',
  authenticate,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { role, id } = req.user!;
    const { status, page = '1', limit = '10' } = req.query;

    let query: any = {};

    if (role === 'patient') {
      query.patient = id;
    } else if (role === 'driver') {
      query.driver = id;
    } else if (role === 'hospital_staff') {
      // Hospital staff see bookings related to their hospital
      query = {};
    }
    // Admin sees all

    if (status) query.status = status;

    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);
    const skip = (pageNum - 1) * limitNum;

    const [bookings, total] = await Promise.all([
      Booking.find(query)
        .populate('patient', 'name phone')
        .populate('driver', 'name phone')
        .populate('ambulance', 'vehicleNumber type')
        .populate('hospital', 'name address')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum),
      Booking.countDocuments(query),
    ]);

    res.json({
      success: true,
      data: {
        bookings,
        pagination: {
          total,
          page: pageNum,
          limit: limitNum,
          pages: Math.ceil(total / limitNum),
        },
      },
    });
  })
);

// GET /api/bookings/:bookingId — Get specific booking
router.get(
  '/:bookingId',
  authenticate,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { bookingId } = req.params;
    const { role, id } = req.user!;

    const booking = await Booking.findOne({ bookingId })
      .populate('patient', 'name phone email bloodGroup emergencyContact')
      .populate('driver', 'name phone')
      .populate('ambulance', 'vehicleNumber type capabilities equipment currentLocation')
      .populate('hospital', 'name address phone location')
      .populate('feedback');

    if (!booking) throw createError('Booking not found', 404);

    // Authorization check
    if (role === 'patient' && booking.patient._id.toString() !== id) {
      throw createError('Access denied to this booking', 403);
    }
    if (role === 'driver' && booking.driver?._id?.toString() !== id) {
      throw createError('Access denied to this booking', 403);
    }

    res.json({ success: true, data: { booking } });
  })
);

// POST /api/bookings/:bookingId/cancel — Cancel booking
router.post(
  '/:bookingId/cancel',
  authenticate,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { bookingId } = req.params;
    const { reason } = req.body;
    const { id, role } = req.user!;

    const booking = await Booking.findOne({ bookingId });
    if (!booking) throw createError('Booking not found', 404);

    // Only patient or admin can cancel
    if (role === 'patient' && booking.patient.toString() !== id) {
      throw createError('Cannot cancel another patient\'s booking', 403);
    }

    const cancellableStatuses = ['pending', 'dispatching', 'assigned'];
    if (!cancellableStatuses.includes(booking.status)) {
      throw createError(
        `Cannot cancel a booking in status: ${booking.status}. Cancellation is only allowed before acceptance.`,
        400
      );
    }

    // Release ambulance if assigned
    if (booking.ambulance) {
      await Ambulance.findByIdAndUpdate(booking.ambulance, {
        status: 'available',
        currentBooking: null,
      });
    }

    await Booking.findByIdAndUpdate(booking._id, {
      status: 'cancelled',
      cancellationReason: reason || 'No reason provided',
      cancelledBy: id,
      cancellationTime: new Date(),
    });

    await AuditLog.create({
      actor: id,
      actorRole: role,
      action: 'BOOKING_CANCELLED',
      targetModel: 'Booking',
      targetId: booking._id,
      details: { bookingId, reason },
    }).catch(() => {});

    res.json({ success: true, message: 'Booking cancelled successfully' });
  })
);

// GET /api/bookings/:bookingId/hospitals — Hospital recommendations
router.get(
  '/:bookingId/hospitals',
  authenticate,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { bookingId } = req.params;
    const booking = await Booking.findOne({ bookingId });
    if (!booking) throw createError('Booking not found', 404);

    const recommendations = await recommendHospitals(
      booking.pickupLocation.lat,
      booking.pickupLocation.lng,
      booking.emergencyCategory
    );

    res.json({
      success: true,
      data: {
        recommendations,
        emergencyCategory: booking.emergencyCategory,
        patientLocation: booking.pickupLocation,
        note: 'Hospital recommendations are based on available data. Capacity may not reflect real-time availability.',
      },
    });
  })
);

// POST /api/bookings/:bookingId/select-hospital — Select hospital
router.post(
  '/:bookingId/select-hospital',
  authenticate,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { bookingId } = req.params;
    const { hospitalId, reason } = req.body;
    const { role, id } = req.user!;

    const booking = await Booking.findOne({ bookingId });
    if (!booking) throw createError('Booking not found', 404);

    if (role === 'driver' && booking.driver?.toString() !== id) {
      throw createError('Not authorized for this booking', 403);
    }

    await Booking.findByIdAndUpdate(booking._id, {
      hospital: hospitalId,
      selectedHospitalReason: reason,
    });

    // Update trip with destination
    const trip = await Trip.findOneAndUpdate(
      { booking: booking._id },
      { hospital: hospitalId }
    );

    // Notify hospital
    await createNotification({
      recipientId: hospitalId, // Hospital notification (hospital staff)
      type: 'hospital_pre_arrival',
      title: 'Pre-Arrival Alert',
      message: `Ambulance en route to your facility with ${booking.emergencyCategory} patient. Estimated arrival: soon.`,
      relatedBookingId: booking._id.toString(),
    });

    io.to('admin_room').emit('hospital_selected', { bookingId, hospitalId });

    res.json({ success: true, message: 'Hospital selected and notified' });
  })
);

export default router;
