import { Router, Response } from 'express';
import { Notification } from '../models/Notification';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { asyncHandler, createError } from '../middleware/errorHandler';

const router = Router();

// GET /api/notifications — Get user's notifications
router.get('/', authenticate, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { page = '1', limit = '20', unreadOnly } = req.query;
  const pageNum = parseInt(page as string);
  const limitNum = parseInt(limit as string);

  const query: any = { recipient: req.user!.id };
  if (unreadOnly === 'true') query.isRead = false;

  const [notifications, total, unreadCount] = await Promise.all([
    Notification.find(query)
      .sort({ createdAt: -1 })
      .skip((pageNum - 1) * limitNum)
      .limit(limitNum),
    Notification.countDocuments(query),
    Notification.countDocuments({ recipient: req.user!.id, isRead: false }),
  ]);

  res.json({
    success: true,
    data: {
      notifications,
      unreadCount,
      pagination: { total, page: pageNum, limit: limitNum, pages: Math.ceil(total / limitNum) },
    },
  });
}));

// PUT /api/notifications/:id/read — Mark as read
router.put('/:id/read', authenticate, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const notification = await Notification.findOneAndUpdate(
    { _id: req.params.id, recipient: req.user!.id },
    { isRead: true, readAt: new Date() },
    { new: true }
  );
  if (!notification) throw createError('Notification not found', 404);
  res.json({ success: true, message: 'Notification marked as read' });
}));

// PUT /api/notifications/read-all — Mark all as read
router.put('/read-all', authenticate, asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  await Notification.updateMany(
    { recipient: req.user!.id, isRead: false },
    { isRead: true, readAt: new Date() }
  );
  res.json({ success: true, message: 'All notifications marked as read' });
}));

export default router;
