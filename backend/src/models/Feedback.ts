import mongoose, { Document, Schema } from 'mongoose';

export interface IFeedback extends Document {
  _id: mongoose.Types.ObjectId;
  booking: mongoose.Types.ObjectId;
  patient: mongoose.Types.ObjectId;
  driver?: mongoose.Types.ObjectId;
  hospital?: mongoose.Types.ObjectId;
  overallRating: number;
  driverRating?: number;
  hospitalRating?: number;
  responseTimeRating?: number;
  comment?: string;
  tags?: string[];
  isAnonymous: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const FeedbackSchema = new Schema<IFeedback>(
  {
    booking: { type: Schema.Types.ObjectId, ref: 'Booking', required: true, unique: true },
    patient: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    driver: { type: Schema.Types.ObjectId, ref: 'User' },
    hospital: { type: Schema.Types.ObjectId, ref: 'Hospital' },
    overallRating: { type: Number, required: true, min: 1, max: 5 },
    driverRating: { type: Number, min: 1, max: 5 },
    hospitalRating: { type: Number, min: 1, max: 5 },
    responseTimeRating: { type: Number, min: 1, max: 5 },
    comment: { type: String, maxlength: 1000 },
    tags: [String],
    isAnonymous: { type: Boolean, default: false },
  },
  { timestamps: true }
);


FeedbackSchema.index({ patient: 1 });
FeedbackSchema.index({ driver: 1 });
FeedbackSchema.index({ hospital: 1 });

export const Feedback = mongoose.model<IFeedback>('Feedback', FeedbackSchema);
