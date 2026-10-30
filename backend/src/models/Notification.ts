import mongoose, { Document, Schema } from 'mongoose';

export type NotificationType =
  | 'booking_created'
  | 'ambulance_assigned'
  | 'driver_accepted'
  | 'driver_rejected'
  | 'driver_en_route'
  | 'ambulance_arrived'
  | 'patient_onboard'
  | 'hospital_selected'
  | 'hospital_pre_arrival'
  | 'trip_completed'
  | 'assignment_timeout'
  | 'no_ambulance_available'
  | 'booking_cancelled'
  | 'system';

export interface INotification extends Document {
  _id: mongoose.Types.ObjectId;
  recipient: mongoose.Types.ObjectId;
  type: NotificationType;
  title: string;
  message: string;
  data?: Record<string, any>;
  isRead: boolean;
  readAt?: Date;
  relatedBooking?: mongoose.Types.ObjectId;
  relatedTrip?: mongoose.Types.ObjectId;
  deliveredAt?: Date;
  isSimulated: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const NotificationSchema = new Schema<INotification>(
  {
    recipient: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    type: {
      type: String,
      enum: [
        'booking_created', 'ambulance_assigned', 'driver_accepted',
        'driver_rejected', 'driver_en_route', 'ambulance_arrived',
        'patient_onboard', 'hospital_selected', 'hospital_pre_arrival',
        'trip_completed', 'assignment_timeout', 'no_ambulance_available',
        'booking_cancelled', 'system'
      ],
      required: true,
    },
    title: { type: String, required: true },
    message: { type: String, required: true },
    data: Schema.Types.Mixed,
    isRead: { type: Boolean, default: false },
    readAt: Date,
    relatedBooking: { type: Schema.Types.ObjectId, ref: 'Booking' },
    relatedTrip: { type: Schema.Types.ObjectId, ref: 'Trip' },
    deliveredAt: Date,
    isSimulated: { type: Boolean, default: true },
  },
  { timestamps: true }
);

NotificationSchema.index({ recipient: 1, isRead: 1, createdAt: -1 });
NotificationSchema.index({ relatedBooking: 1 });

export const Notification = mongoose.model<INotification>('Notification', NotificationSchema);
