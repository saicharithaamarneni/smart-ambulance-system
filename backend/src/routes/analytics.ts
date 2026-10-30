import { Router, Response } from 'express';
import { authenticate, authorize, AuthenticatedRequest } from '../middleware/auth';
import { asyncHandler, createError } from '../middleware/errorHandler';
import { Booking } from '../models/Booking';
import { Trip } from '../models/Trip';
import { Ambulance } from '../models/Ambulance';
import { Hospital } from '../models/Hospital';
import { User } from '../models/User';
import { Feedback } from '../models/Feedback';

const router = Router();

// GET /api/analytics/overview — Dashboard overview stats
router.get(
  '/overview',
  authenticate,
  authorize('admin', 'hospital_staff'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const [
      totalBookings,
      activeTrips,
      completedTrips,
      cancelledBookings,
      availableAmbulances,
      totalAmbulances,
      totalHospitals,
      totalDrivers,
      totalPatients,
      pendingBookings,
    ] = await Promise.all([
      Booking.countDocuments(),
      Trip.countDocuments({ currentStatus: { $nin: ['completed'] } }),
      Trip.countDocuments({ currentStatus: 'completed' }),
      Booking.countDocuments({ status: 'cancelled' }),
      Ambulance.countDocuments({ status: 'available', isOnline: true }),
      Ambulance.countDocuments(),
      Hospital.countDocuments({ isActive: true }),
      User.countDocuments({ role: 'driver', isActive: true }),
      User.countDocuments({ role: 'patient', isActive: true }),
      Booking.countDocuments({ status: { $in: ['pending', 'dispatching'] } }),
    ]);

    // Assignment success rate
    const assignedBookings = await Booking.countDocuments({
      status: { $nin: ['pending', 'failed', 'no_ambulance_available'] },
    });
    const assignmentSuccessRate = totalBookings > 0
      ? ((assignedBookings / totalBookings) * 100).toFixed(1)
      : '0';

    // Average dispatch time
    const dispatchTimeAgg = await Booking.aggregate([
      { $match: { requestToAssignmentTime: { $exists: true, $gt: 0 } } },
      { $group: { _id: null, avg: { $avg: '$requestToAssignmentTime' } } },
    ]);
    const avgDispatchSeconds = dispatchTimeAgg[0]?.avg || 0;

    // Average trip duration
    const tripDurationAgg = await Trip.aggregate([
      { $match: { actualDurationMinutes: { $exists: true, $gt: 0 } } },
      { $group: { _id: null, avg: { $avg: '$actualDurationMinutes' } } },
    ]);
    const avgTripDurationMinutes = tripDurationAgg[0]?.avg || 0;

    res.json({
      success: true,
      data: {
        bookings: { total: totalBookings, active: activeTrips, completed: completedTrips, cancelled: cancelledBookings, pending: pendingBookings },
        ambulances: { total: totalAmbulances, available: availableAmbulances, busy: totalAmbulances - availableAmbulances },
        hospitals: { total: totalHospitals },
        users: { drivers: totalDrivers, patients: totalPatients },
        performance: {
          assignmentSuccessRate: `${assignmentSuccessRate}%`,
          avgDispatchTimeSeconds: Math.round(avgDispatchSeconds),
          avgTripDurationMinutes: Math.round(avgTripDurationMinutes),
        },
      },
    });
  })
);

// GET /api/analytics/bookings-over-time — Booking trends
router.get(
  '/bookings-over-time',
  authenticate,
  authorize('admin'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { days = '30' } = req.query;
    const daysNum = parseInt(days as string);
    const startDate = new Date(Date.now() - daysNum * 24 * 60 * 60 * 1000);

    const data = await Booking.aggregate([
      { $match: { createdAt: { $gte: startDate } } },
      {
        $group: {
          _id: {
            year: { $year: '$createdAt' },
            month: { $month: '$createdAt' },
            day: { $dayOfMonth: '$createdAt' },
          },
          count: { $sum: 1 },
          completed: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
          cancelled: { $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] } },
        },
      },
      { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 } },
    ]);

    const formatted = data.map((d) => ({
      date: `${d._id.year}-${String(d._id.month).padStart(2, '0')}-${String(d._id.day).padStart(2, '0')}`,
      total: d.count,
      completed: d.completed,
      cancelled: d.cancelled,
    }));

    res.json({ success: true, data: { bookings: formatted } });
  })
);

// GET /api/analytics/emergency-categories — Category breakdown
router.get(
  '/emergency-categories',
  authenticate,
  authorize('admin'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const data = await Booking.aggregate([
      { $group: { _id: '$emergencyCategory', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]);

    res.json({
      success: true,
      data: { categories: data.map((d) => ({ category: d._id, count: d.count })) },
    });
  })
);

// GET /api/analytics/ambulance-utilization — Ambulance usage stats
router.get(
  '/ambulance-utilization',
  authenticate,
  authorize('admin'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const data = await Trip.aggregate([
      { $match: { currentStatus: 'completed' } },
      {
        $group: {
          _id: '$ambulance',
          totalTrips: { $sum: 1 },
          avgDuration: { $avg: '$actualDurationMinutes' },
          totalDistance: { $sum: '$distanceKm' },
        },
      },
      {
        $lookup: {
          from: 'ambulances',
          localField: '_id',
          foreignField: '_id',
          as: 'ambulance',
        },
      },
      { $unwind: '$ambulance' },
      {
        $project: {
          vehicleNumber: '$ambulance.vehicleNumber',
          type: '$ambulance.type',
          totalTrips: 1,
          avgDuration: { $round: ['$avgDuration', 1] },
          totalDistance: { $round: ['$totalDistance', 1] },
        },
      },
      { $sort: { totalTrips: -1 } },
    ]);

    res.json({ success: true, data: { utilization: data } });
  })
);

// GET /api/analytics/response-times — Response time metrics
router.get(
  '/response-times',
  authenticate,
  authorize('admin'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const metrics = await Booking.aggregate([
      {
        $match: {
          $or: [
            { requestToAssignmentTime: { $exists: true } },
            { assignmentToAcceptanceTime: { $exists: true } },
            { requestToPickupTime: { $exists: true } },
          ],
        },
      },
      {
        $group: {
          _id: null,
          avgRequestToAssignment: { $avg: '$requestToAssignmentTime' },
          avgAssignmentToAcceptance: { $avg: '$assignmentToAcceptanceTime' },
          avgRequestToPickup: { $avg: '$requestToPickupTime' },
          minRequestToAssignment: { $min: '$requestToAssignmentTime' },
          maxRequestToAssignment: { $max: '$requestToAssignmentTime' },
        },
      },
    ]);

    const result = metrics[0] || {
      avgRequestToAssignment: 0,
      avgAssignmentToAcceptance: 0,
      avgRequestToPickup: 0,
      minRequestToAssignment: 0,
      maxRequestToAssignment: 0,
    };

    res.json({
      success: true,
      data: {
        metrics: {
          avgRequestToAssignmentSeconds: Math.round(result.avgRequestToAssignment || 0),
          avgAssignmentToAcceptanceSeconds: Math.round(result.avgAssignmentToAcceptance || 0),
          avgRequestToPickupSeconds: Math.round(result.avgRequestToPickup || 0),
          minDispatchSeconds: Math.round(result.minRequestToAssignment || 0),
          maxDispatchSeconds: Math.round(result.maxRequestToAssignment || 0),
        },
        note: 'All metrics calculated from actual database records',
      },
    });
  })
);

// GET /api/analytics/feedback — Feedback summary
router.get(
  '/feedback',
  authenticate,
  authorize('admin'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const summary = await Feedback.aggregate([
      {
        $group: {
          _id: null,
          avgOverall: { $avg: '$overallRating' },
          avgDriver: { $avg: '$driverRating' },
          avgHospital: { $avg: '$hospitalRating' },
          avgResponseTime: { $avg: '$responseTimeRating' },
          total: { $sum: 1 },
          fiveStars: { $sum: { $cond: [{ $eq: ['$overallRating', 5] }, 1, 0] } },
          fourStars: { $sum: { $cond: [{ $eq: ['$overallRating', 4] }, 1, 0] } },
        },
      },
    ]);

    res.json({
      success: true,
      data: { feedback: summary[0] || { avgOverall: 0, total: 0 } },
    });
  })
);

export default router;
