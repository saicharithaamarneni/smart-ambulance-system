import { Router, Response } from 'express';
import { z } from 'zod';
import { User } from '../models/User';
import { generateToken, authenticate, AuthenticatedRequest } from '../middleware/auth';
import { asyncHandler, createError } from '../middleware/errorHandler';
import { AuditLog } from '../models/AuditLog';

const router = Router();

const RegisterSchema = z.object({
  name: z.string().min(2).max(100),
  email: z.string().email(),
  password: z.string().min(6),
  phone: z.string().min(10),
  role: z.enum(['patient', 'driver', 'hospital_staff', 'admin']),
  address: z.string().optional(),
  bloodGroup: z.string().optional(),
  dateOfBirth: z.string().optional(),
});

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// POST /api/auth/register
router.post(
  '/register',
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const validated = RegisterSchema.safeParse(req.body);
    if (!validated.success) {
      throw createError(validated.error.errors.map((e) => e.message).join(', '), 400);
    }

    const { name, email, password, phone, role, address, bloodGroup, dateOfBirth } = validated.data;

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      throw createError('Email already registered', 409);
    }

    const user = await User.create({
      name,
      email,
      password,
      phone,
      role,
      address,
      bloodGroup,
      dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : undefined,
    });

    const token = generateToken({ id: user._id.toString(), email: user.email, role: user.role });

    res.status(201).json({
      success: true,
      message: 'Registration successful',
      data: {
        token,
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          phone: user.phone,
          role: user.role,
          bloodGroup: user.bloodGroup,
        },
      },
    });
  })
);

// POST /api/auth/login
router.post(
  '/login',
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const validated = LoginSchema.safeParse(req.body);
    if (!validated.success) {
      throw createError('Invalid email or password format', 400);
    }

    const { email, password } = validated.data;

    const user = await User.findOne({ email }).select('+password');
    if (!user || !user.isActive) {
      throw createError('Invalid email or password', 401);
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      throw createError('Invalid email or password', 401);
    }

    user.lastLogin = new Date();
    await user.save({ validateBeforeSave: false });

    const token = generateToken({ id: user._id.toString(), email: user.email, role: user.role });

    await AuditLog.create({
      actor: user._id,
      actorRole: user.role,
      action: 'USER_LOGIN',
      details: { email: user.email, ip: req.ip },
    }).catch(() => {});

    res.json({
      success: true,
      message: 'Login successful',
      data: {
        token,
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          phone: user.phone,
          role: user.role,
          bloodGroup: user.bloodGroup,
          lastLogin: user.lastLogin,
        },
      },
    });
  })
);

// GET /api/auth/me
router.get(
  '/me',
  authenticate,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const user = await User.findById(req.user!.id).select('-password');
    if (!user) throw createError('User not found', 404);
    res.json({ success: true, data: { user } });
  })
);

// PUT /api/auth/profile
router.put(
  '/profile',
  authenticate,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { name, phone, address, bloodGroup, dateOfBirth, emergencyContact } = req.body;
    const user = await User.findByIdAndUpdate(
      req.user!.id,
      { name, phone, address, bloodGroup, dateOfBirth, emergencyContact },
      { new: true, runValidators: true }
    );
    if (!user) throw createError('User not found', 404);
    res.json({ success: true, message: 'Profile updated', data: { user } });
  })
);

// POST /api/auth/change-password
router.post(
  '/change-password',
  authenticate,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      throw createError('Both current and new password are required', 400);
    }
    if (newPassword.length < 6) {
      throw createError('New password must be at least 6 characters', 400);
    }

    const user = await User.findById(req.user!.id).select('+password');
    if (!user) throw createError('User not found', 404);

    const isMatch = await user.comparePassword(currentPassword);
    if (!isMatch) throw createError('Current password is incorrect', 401);

    user.password = newPassword;
    await user.save();

    res.json({ success: true, message: 'Password changed successfully' });
  })
);

export default router;
