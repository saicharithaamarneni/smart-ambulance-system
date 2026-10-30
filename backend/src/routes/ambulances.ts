import { Router, Response } from 'express';
import { Ambulance } from '../models/Ambulance';
import { authenticate, authorize, AuthenticatedRequest } from '../middleware/auth';
import { asyncHandler, createError } from '../middleware/errorHandler';
import { isValidCoordinate } from '../utils/geoUtils';
import { io } from '../server';
import { AuditLog } from '../models/AuditLog';

const router = Router();

// GET /api/ambulances — Get all ambulances (admin) or available (public)
router.get(
  '/',
  authenticate,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { status, isOnline, page = '1', limit = '20' } = req.query;
    const { role } = req.user!;

    let query: any = {};
    if (role !== 'admin' && role !== 'hospital_staff') {
      query.status = 'available';
      query.isOnline = true;
    } else {
      if (status) query.status = status;
      if (isOnline !== undefined) query.isOnline = isOnline === 'true';
    }

    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);

    const [ambulances, total] = await Promise.all([
      Ambulance.find(query)
        .populate('driver', 'name phone email')
        .sort({ status: 1, lastLocationUpdate: -1 })
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum),
      Ambulance.countDocuments(query),
    ]);

    res.json({
      success: true,
      data: {
        ambulances,
        pagination: { total, page: pageNum, limit: limitNum, pages: Math.ceil(total / limitNum) },
      },
    });
  })
);

// GET /api/ambulances/fleet — Fleet overview for admin/dispatcher
router.get(
  '/fleet',
  authenticate,
  authorize('admin'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const [available, assigned, transporting, maintenance, offline] = await Promise.all([
      Ambulance.countDocuments({ status: 'available', isOnline: true }),
      Ambulance.countDocuments({ status: 'assigned' }),
      Ambulance.countDocuments({ status: 'transporting' }),
      Ambulance.countDocuments({ status: 'maintenance' }),
      Ambulance.countDocuments({ $or: [{ status: 'offline' }, { isOnline: false }] }),
    ]);

    const allAmbulances = await Ambulance.find()
      .populate('driver', 'name phone')
      .populate('currentBooking', 'bookingId emergencyCategory');

    res.json({
      success: true,
      data: {
        stats: { available, assigned, transporting, maintenance, offline, total: allAmbulances.length },
        ambulances: allAmbulances,
      },
    });
  })
);

// POST /api/ambulances — Create ambulance (admin)
router.post(
  '/',
  authenticate,
  authorize('admin'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { vehicleNumber, type, capabilities, equipment, make, model, yearOfManufacture } = req.body;

    if (!vehicleNumber || !type) {
      throw createError('Vehicle number and type are required', 400);
    }

    const ambulance = await Ambulance.create({
      vehicleNumber: vehicleNumber.toUpperCase(),
      type,
      capabilities: capabilities || [],
      equipment: equipment || [],
      make,
      model,
      yearOfManufacture,
    });

    await AuditLog.create({
      actor: req.user!.id,
      actorRole: 'admin',
      action: 'AMBULANCE_CREATED',
      targetModel: 'Ambulance',
      targetId: ambulance._id,
      details: { vehicleNumber: ambulance.vehicleNumber, type },
    }).catch(() => {});

    res.status(201).json({ success: true, message: 'Ambulance registered', data: { ambulance } });
  })
);

// PUT /api/ambulances/:id — Update ambulance
router.put(
  '/:id',
  authenticate,
  authorize('admin'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const ambulance = await Ambulance.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });
    if (!ambulance) throw createError('Ambulance not found', 404);

    await AuditLog.create({
      actor: req.user!.id,
      actorRole: 'admin',
      action: 'AMBULANCE_UPDATED',
      targetModel: 'Ambulance',
      targetId: ambulance._id,
      details: req.body,
    }).catch(() => {});

    res.json({ success: true, message: 'Ambulance updated', data: { ambulance } });
  })
);

// DELETE /api/ambulances/:id
router.delete(
  '/:id',
  authenticate,
  authorize('admin'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const ambulance = await Ambulance.findByIdAndDelete(req.params.id);
    if (!ambulance) throw createError('Ambulance not found', 404);
    res.json({ success: true, message: 'Ambulance removed' });
  })
);

// PUT /api/ambulances/:id/assign-driver — Assign driver to ambulance
router.put(
  '/:id/assign-driver',
  authenticate,
  authorize('admin'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { driverId } = req.body;
    if (!driverId) throw createError('Driver ID is required', 400);

    const ambulance = await Ambulance.findByIdAndUpdate(
      req.params.id,
      { driver: driverId },
      { new: true }
    ).populate('driver', 'name phone email');

    if (!ambulance) throw createError('Ambulance not found', 404);

    await AuditLog.create({
      actor: req.user!.id,
      actorRole: 'admin',
      action: 'DRIVER_ASSIGNED_TO_AMBULANCE',
      targetModel: 'Ambulance',
      targetId: ambulance._id,
      details: { driverId, vehicleNumber: ambulance.vehicleNumber },
    }).catch(() => {});

    res.json({ success: true, message: 'Driver assigned', data: { ambulance } });
  })
);

// PUT /api/ambulances/:id/location — Update location (driver only)
router.put(
  '/:id/location',
  authenticate,
  authorize('driver'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { lat, lng, accuracy, heading, speed } = req.body;

    if (!isValidCoordinate(lat, lng)) {
      throw createError('Invalid GPS coordinates', 400);
    }

    const ambulance = await Ambulance.findById(req.params.id);
    if (!ambulance) throw createError('Ambulance not found', 404);

    // Verify the driver owns this ambulance
    if (ambulance.driver?.toString() !== req.user!.id) {
      throw createError('Not authorized to update this ambulance\'s location', 403);
    }

    const now = new Date();
    await Ambulance.findByIdAndUpdate(req.params.id, {
      currentLocation: { lat, lng, accuracy, heading, speed, timestamp: now },
      lastLocationUpdate: now,
    });

    // Emit real-time location update to admin dashboard and relevant patients
    io.to('admin_room').emit('ambulance_location_update', {
      ambulanceId: ambulance._id,
      vehicleNumber: ambulance.vehicleNumber,
      location: { lat, lng, heading, speed },
      timestamp: now,
      isSimulated: ambulance.isSimulated,
    });

    // If this ambulance has an active booking, notify the patient
    if (ambulance.currentBooking) {
      const { Booking } = await import('../models/Booking');
      const booking = await Booking.findById(ambulance.currentBooking);
      if (booking) {
        io.to(`patient_${booking.patient}`).emit('ambulance_location_update', {
          vehicleNumber: ambulance.vehicleNumber,
          location: { lat, lng, heading, speed },
          timestamp: now,
          isSimulated: ambulance.isSimulated,
        });
      }
    }

    res.json({ success: true, message: 'Location updated' });
  })
);

// PUT /api/ambulances/:id/availability — Toggle online/offline
router.put(
  '/:id/availability',
  authenticate,
  authorize('driver', 'admin'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { isOnline } = req.body;
    if (isOnline === undefined) throw createError('isOnline field is required', 400);

    const ambulance = await Ambulance.findById(req.params.id);
    if (!ambulance) throw createError('Ambulance not found', 404);

    if (req.user!.role === 'driver' && ambulance.driver?.toString() !== req.user!.id) {
      throw createError('Not authorized', 403);
    }

    await Ambulance.findByIdAndUpdate(req.params.id, {
      isOnline,
      status: isOnline ? 'available' : 'offline',
    });

    io.to('admin_room').emit('ambulance_availability_change', {
      ambulanceId: ambulance._id,
      vehicleNumber: ambulance.vehicleNumber,
      isOnline,
    });

    res.json({ success: true, message: `Ambulance is now ${isOnline ? 'online' : 'offline'}` });
  })
);

export default router;
