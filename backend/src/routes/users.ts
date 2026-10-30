import { Router, Response } from 'express';
import { User } from '../models/User';
import { authenticate, authorize, AuthenticatedRequest } from '../middleware/auth';
import { asyncHandler, createError } from '../middleware/errorHandler';

const router = Router();

// GET /api/users — Admin gets all users
router.get('/', authenticate, authorize('admin'), asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const users = await User.find().select('-password').sort({ createdAt: -1 });
  res.json({ success: true, data: { users } });
}));

// GET /api/users/:id
router.get('/:id', authenticate, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id, role } = req.user!;
  if (role !== 'admin' && req.params.id !== id) {
    throw createError('Access denied', 403);
  }
  const user = await User.findById(req.params.id).select('-password');
  if (!user) throw createError('User not found', 404);
  res.json({ success: true, data: { user } });
}));

// PUT /api/users/:id
router.put('/:id', authenticate, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id, role } = req.user!;
  if (role !== 'admin' && req.params.id !== id) {
    throw createError('Access denied', 403);
  }
  const { name, phone, address, bloodGroup, emergencyContact } = req.body;
  const user = await User.findByIdAndUpdate(
    req.params.id,
    { name, phone, address, bloodGroup, emergencyContact },
    { new: true, runValidators: true }
  ).select('-password');
  if (!user) throw createError('User not found', 404);
  res.json({ success: true, data: { user } });
}));

export default router;
