import { Router, Response } from 'express';
import { authenticate, authorize, AuthenticatedRequest } from '../middleware/auth';
import { asyncHandler, createError } from '../middleware/errorHandler';
import { User } from '../models/User';
import { Booking } from '../models/Booking';
import { Trip } from '../models/Trip';
import { Ambulance } from '../models/Ambulance';
import { AuditLog } from '../models/AuditLog';
import { Notification } from '../models/Notification';
import { dispatchAmbulance } from '../services/dispatchService';
import { io } from '../server';

const router = Router();

// All admin routes require admin role
router.use(authenticate, authorize('admin'));

// GET /api/admin/users — Get all users
router.get(
  '/users',
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { role, isActive, search, page = '1', limit = '20' } = req.query;
    let query: any = {};
    if (role) query.role = role;
    if (isActive !== undefined) query.isActive = isActive === 'true';
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } },
      ];
    }

    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);

    const [users, total] = await Promise.all([
      User.find(query)
        .select('-password')
        .sort({ createdAt: -1 })
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum),
      User.countDocuments(query),
    ]);

    res.json({
      success: true,
      data: { users, pagination: { total, page: pageNum, limit: limitNum, pages: Math.ceil(total / limitNum) } },
    });
  })
);

// PUT /api/admin/users/:id/toggle-active — Activate/deactivate user
router.put(
  '/users/:id/toggle-active',
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const user = await User.findById(req.params.id);
    if (!user) throw createError('User not found', 404);

    user.isActive = !user.isActive;
    await user.save({ validateBeforeSave: false });

    await AuditLog.create({
      actor: req.user!.id,
      actorRole: 'admin',
      action: user.isActive ? 'USER_ACTIVATED' : 'USER_DEACTIVATED',
      targetModel: 'User',
      targetId: user._id,
      details: { email: user.email },
    }).catch(() => {});

    res.json({ success: true, message: `User ${user.isActive ? 'activated' : 'deactivated'}`, data: { isActive: user.isActive } });
  })
);

// POST /api/admin/bookings/:bookingId/manual-assign — Manual ambulance assignment
router.post(
  '/bookings/:bookingId/manual-assign',
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { bookingId } = req.params;
    const { ambulanceId } = req.body;

    if (!ambulanceId) throw createError('Ambulance ID required', 400);

    const booking = await Booking.findOne({ bookingId });
    if (!booking) throw createError('Booking not found', 404);

    const ambulance = await Ambulance.findById(ambulanceId).populate('driver');
    if (!ambulance) throw createError('Ambulance not found', 404);
    if (!ambulance.isOnline || ambulance.status !== 'available') {
      throw createError('Ambulance is not available for assignment', 400);
    }

    // Atomic assignment
    const reserved = await Ambulance.findOneAndUpdate(
      { _id: ambulanceId, status: 'available' },
      { status: 'assigned', currentBooking: booking._id },
      { new: true }
    );
    if (!reserved) throw createError('Ambulance was just taken by another booking', 409);

    await Booking.findByIdAndUpdate(booking._id, {
      status: 'assigned',
      ambulance: ambulanceId,
      driver: ambulance.driver,
    });

    // Notify driver
    const driverId = (ambulance.driver as any)?._id?.toString();
    if (driverId) {
      io.to(`driver_${driverId}`).emit('new_booking_request', {
        bookingId,
        patient: { location: booking.pickupLocation, emergencyCategory: booking.emergencyCategory },
        manualAssignment: true,
      });
    }

    await AuditLog.create({
      actor: req.user!.id,
      actorRole: 'admin',
      action: 'MANUAL_AMBULANCE_ASSIGNMENT',
      targetModel: 'Booking',
      targetId: booking._id,
      details: { bookingId, ambulanceId, vehicleNumber: ambulance.vehicleNumber, adminId: req.user!.id },
    }).catch(() => {});

    res.json({ success: true, message: `Ambulance ${ambulance.vehicleNumber} manually assigned`, data: { ambulance: { vehicleNumber: ambulance.vehicleNumber } } });
  })
);

// POST /api/admin/bookings/:bookingId/force-dispatch — Force re-dispatch
router.post(
  '/bookings/:bookingId/force-dispatch',
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { bookingId } = req.params;
    const booking = await Booking.findOne({ bookingId });
    if (!booking) throw createError('Booking not found', 404);

    // Reset for re-dispatch
    await Booking.findByIdAndUpdate(booking._id, {
      status: 'pending',
      assignmentAttempts: [],
      ambulance: null,
      driver: null,
    });

    setImmediate(() => {
      dispatchAmbulance(bookingId).catch(console.error);
    });

    await AuditLog.create({
      actor: req.user!.id,
      actorRole: 'admin',
      action: 'FORCE_REDISPATCH',
      targetModel: 'Booking',
      targetId: booking._id,
      details: { bookingId },
    }).catch(() => {});

    res.json({ success: true, message: 'Force re-dispatch initiated' });
  })
);

// GET /api/admin/audit-logs — Get audit logs
router.get(
  '/audit-logs',
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { page = '1', limit = '20', action } = req.query;
    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);

    const query: any = {};
    if (action) query.action = action;

    const [logs, total] = await Promise.all([
      AuditLog.find(query)
        .populate('actor', 'name email role')
        .sort({ createdAt: -1 })
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum),
      AuditLog.countDocuments(query),
    ]);

    res.json({
      success: true,
      data: { logs, pagination: { total, page: pageNum, limit: limitNum, pages: Math.ceil(total / limitNum) } },
    });
  })
);

// GET /api/admin/notifications — All notifications
router.get(
  '/notifications',
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { page = '1', limit = '20' } = req.query;
    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);

    const [notifications, total] = await Promise.all([
      Notification.find()
        .populate('recipient', 'name email role')
        .sort({ createdAt: -1 })
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum),
      Notification.countDocuments(),
    ]);

    res.json({
      success: true,
      data: { notifications, pagination: { total, page: pageNum, limit: limitNum, pages: Math.ceil(total / limitNum) } },
    });
  })
);

export default router;
