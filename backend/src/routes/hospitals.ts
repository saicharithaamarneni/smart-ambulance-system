import { Router, Response } from 'express';
import { Hospital } from '../models/Hospital';
import { authenticate, authorize, AuthenticatedRequest } from '../middleware/auth';
import { asyncHandler, createError } from '../middleware/errorHandler';
import { AuditLog } from '../models/AuditLog';
import { io } from '../server';

const router = Router();

// GET /api/hospitals — Get all hospitals
router.get(
  '/',
  authenticate,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { specialty, hasICU, page = '1', limit = '20' } = req.query;
    let query: any = { isActive: true };

    if (specialty) {
      query.specialties = { $regex: specialty as string, $options: 'i' };
    }
    if (hasICU === 'true') {
      query['icuBeds.available'] = { $gt: 0 };
    }

    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);

    const [hospitals, total] = await Promise.all([
      Hospital.find(query)
        .select('-preArrivalNotifications -staffMembers')
        .sort({ name: 1 })
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum),
      Hospital.countDocuments(query),
    ]);

    // Mark stale capacity data
    const STALE_THRESHOLD_MINUTES = 30;
    const hospitalsWithStaleness = hospitals.map((h) => {
      const ageMs = Date.now() - h.capacityLastUpdated.getTime();
      const isStale = ageMs > STALE_THRESHOLD_MINUTES * 60 * 1000;
      return { ...h.toObject(), isCapacityStale: isStale };
    });

    res.json({
      success: true,
      data: {
        hospitals: hospitalsWithStaleness,
        pagination: { total, page: pageNum, limit: limitNum, pages: Math.ceil(total / limitNum) },
      },
    });
  })
);

// GET /api/hospitals/:id — Get single hospital
router.get(
  '/:id',
  authenticate,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const hospital = await Hospital.findById(req.params.id).populate('staffMembers', 'name email phone');
    if (!hospital) throw createError('Hospital not found', 404);
    res.json({ success: true, data: { hospital } });
  })
);

// POST /api/hospitals — Create hospital (admin)
router.post(
  '/',
  authenticate,
  authorize('admin'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const hospital = await Hospital.create({ ...req.body, isDemo: req.body.isDemo !== false });

    await AuditLog.create({
      actor: req.user!.id,
      actorRole: 'admin',
      action: 'HOSPITAL_CREATED',
      targetModel: 'Hospital',
      targetId: hospital._id,
      details: { name: hospital.name },
    }).catch(() => {});

    res.status(201).json({ success: true, message: 'Hospital registered', data: { hospital } });
  })
);

// PUT /api/hospitals/:id — Update hospital info (admin)
router.put(
  '/:id',
  authenticate,
  authorize('admin', 'hospital_staff'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const hospital = await Hospital.findByIdAndUpdate(
      req.params.id,
      { ...req.body },
      { new: true, runValidators: true }
    );
    if (!hospital) throw createError('Hospital not found', 404);

    await AuditLog.create({
      actor: req.user!.id,
      actorRole: req.user!.role,
      action: 'HOSPITAL_UPDATED',
      targetModel: 'Hospital',
      targetId: hospital._id,
      details: req.body,
    }).catch(() => {});

    res.json({ success: true, message: 'Hospital updated', data: { hospital } });
  })
);

// PUT /api/hospitals/:id/capacity — Update bed capacity (hospital_staff)
router.put(
  '/:id/capacity',
  authenticate,
  authorize('hospital_staff', 'admin'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { icuAvailable, icuTotal, generalAvailable, generalTotal, edAvailable, edCapacity, edCurrentOccupancy } = req.body;

    const hospital = await Hospital.findById(req.params.id);
    if (!hospital) throw createError('Hospital not found', 404);

    // Validate: available cannot exceed total, no negatives
    const effectiveIcuTotal = icuTotal !== undefined ? icuTotal : hospital.icuBeds?.total;
    const effectiveGenTotal = generalTotal !== undefined ? generalTotal : hospital.generalBeds?.total;

    if (icuAvailable !== undefined && effectiveIcuTotal !== undefined && icuAvailable > effectiveIcuTotal) {
      throw createError('ICU available beds cannot exceed total ICU beds', 400);
    }
    if (generalAvailable !== undefined && effectiveGenTotal !== undefined && generalAvailable > effectiveGenTotal) {
      throw createError('General available beds cannot exceed total general beds', 400);
    }
    if ((icuAvailable !== undefined && icuAvailable < 0) ||
        (icuTotal !== undefined && icuTotal < 0) ||
        (generalAvailable !== undefined && generalAvailable < 0) ||
        (generalTotal !== undefined && generalTotal < 0)) {
      throw createError('Bed counts cannot be negative', 400);
    }

    const updateData: any = { capacityLastUpdated: new Date() };
    if (icuAvailable !== undefined) updateData['icuBeds.available'] = icuAvailable;
    if (icuTotal !== undefined) updateData['icuBeds.total'] = icuTotal;
    if (generalAvailable !== undefined) updateData['generalBeds.available'] = generalAvailable;
    if (generalTotal !== undefined) updateData['generalBeds.total'] = generalTotal;
    if (edAvailable !== undefined) updateData['emergencyDepartment.isAvailable'] = edAvailable;
    if (edCapacity !== undefined) updateData['emergencyDepartment.capacity'] = edCapacity;
    if (edCurrentOccupancy !== undefined) {
      const capacity = edCapacity || hospital.emergencyDepartment.capacity;
      if (edCurrentOccupancy > capacity) {
        throw createError('ED occupancy cannot exceed ED capacity', 400);
      }
      updateData['emergencyDepartment.currentOccupancy'] = edCurrentOccupancy;
    }

    const updatedHospital = await Hospital.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true, runValidators: true }
    );

    // Notify admin dashboard in real-time
    io.to('admin_room').emit('hospital_capacity_update', {
      hospitalId: req.params.id,
      hospitalName: hospital.name,
      updatedAt: new Date(),
    });

    await AuditLog.create({
      actor: req.user!.id,
      actorRole: req.user!.role,
      action: 'HOSPITAL_CAPACITY_UPDATED',
      targetModel: 'Hospital',
      targetId: hospital._id,
      details: updateData,
    }).catch(() => {});

    res.json({
      success: true,
      message: 'Capacity updated successfully',
      data: { hospital: updatedHospital },
      note: hospital.isDemo ? '⚠️ This is DEMO data — not a real hospital' : undefined,
    });
  })
);

// POST /api/hospitals/:id/pre-arrival — Send pre-arrival notification
router.post(
  '/:id/pre-arrival',
  authenticate,
  authorize('driver', 'admin'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { bookingId, patientCondition, estimatedArrival } = req.body;
    const { Booking } = await import('../models/Booking');

    const hospital = await Hospital.findById(req.params.id);
    if (!hospital) throw createError('Hospital not found', 404);

    hospital.preArrivalNotifications.push({
      bookingId,
      notifiedAt: new Date(),
      condition: patientCondition,
      estimatedArrival: new Date(estimatedArrival),
    });
    await hospital.save();

    io.to(`hospital_${req.params.id}`).emit('pre_arrival_alert', {
      bookingId,
      patientCondition,
      estimatedArrival,
      timestamp: new Date(),
    });

    res.json({ success: true, message: 'Pre-arrival notification sent to hospital' });
  })
);

export default router;
