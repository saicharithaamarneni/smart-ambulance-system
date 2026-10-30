import { Router, Response } from 'express';
import { User } from '../models/User';
import { Ambulance } from '../models/Ambulance';
import { Trip } from '../models/Trip';
import { authenticate, authorize, AuthenticatedRequest } from '../middleware/auth';
import { asyncHandler, createError } from '../middleware/errorHandler';
import { handleDriverResponse } from '../services/dispatchService';

const router = Router();

// GET /api/drivers — Get all drivers (admin)
router.get('/', authenticate, authorize('admin'), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const drivers = await User.find({ role: 'driver' }).select('-password');
  const driversWithAmbulance = await Promise.all(
    drivers.map(async (driver) => {
      const ambulance = await Ambulance.findOne({ driver: driver._id });
      const activeTrip = await Trip.findOne({
        driver: driver._id,
        currentStatus: { $nin: ['completed'] },
      }).populate('booking', 'bookingId emergencyCategory');
      return { ...driver.toObject(), ambulance, activeTrip };
    })
  );
  res.json({ success: true, data: { drivers: driversWithAmbulance } });
}));

// GET /api/drivers/me/ambulance — Get driver's ambulance
router.get('/me/ambulance', authenticate, authorize('driver'), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const ambulance = await Ambulance.findOne({ driver: req.user!.id });
  res.json({ success: true, data: { ambulance } });
}));

// POST /api/drivers/respond — Driver responds to booking request
router.post('/respond', authenticate, authorize('driver'), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { bookingId, accepted, reason } = req.body;
  if (!bookingId) throw createError('Booking ID is required', 400);

  const result = await handleDriverResponse(bookingId, req.user!.id, accepted, reason);
  res.json({ success: result.success, message: result.message });
}));

// GET /api/drivers/:id/stats — Driver stats
router.get('/:id/stats', authenticate, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id, role } = req.user!;
  if (role !== 'admin' && req.params.id !== id) {
    throw createError('Access denied', 403);
  }
  
  const totalTrips = await Trip.countDocuments({ driver: req.params.id, currentStatus: 'completed' });
  const avgRating = await Trip.aggregate([
    { $match: { driver: req.params.id as any, currentStatus: 'completed' } },
    { $lookup: { from: 'feedbacks', localField: 'booking', foreignField: 'booking', as: 'feedback' } },
    { $unwind: { path: '$feedback', preserveNullAndEmptyArrays: true } },
    { $group: { _id: null, avgRating: { $avg: '$feedback.driverRating' } } },
  ]);
  
  res.json({ success: true, data: { totalTrips, avgRating: avgRating[0]?.avgRating || 0 } });
}));

export default router;
