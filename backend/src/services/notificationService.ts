import { Notification } from '../models/Notification';
import { io } from '../server';
import { logger } from '../utils/logger';

interface CreateNotificationParams {
  recipientId: string;
  type: string;
  title: string;
  message: string;
  relatedBookingId?: string;
  relatedTripId?: string;
  data?: Record<string, any>;
}

export async function createNotification(params: CreateNotificationParams): Promise<void> {
  try {
    const notification = await Notification.create({
      recipient: params.recipientId,
      type: params.type,
      title: params.title,
      message: params.message,
      relatedBooking: params.relatedBookingId,
      relatedTrip: params.relatedTripId,
      data: params.data,
      deliveredAt: new Date(),
      isSimulated: true, // All notifications are in-app (no real SMS)
    });

    // Deliver via Socket.IO in real-time
    io.to(`user_${params.recipientId}`).emit('notification', {
      _id: notification._id,
      type: notification.type,
      title: notification.title,
      message: notification.message,
      data: notification.data,
      createdAt: notification.createdAt,
      isRead: false,
    });

    logger.debug(`Notification sent to user ${params.recipientId}: ${params.title}`);
  } catch (error) {
    logger.error('Failed to create notification:', error);
  }
}
