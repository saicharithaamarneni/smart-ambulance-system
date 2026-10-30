import mongoose, { Document, Schema } from 'mongoose';

export type EmergencyCategory =
  | 'cardiac_arrest'
  | 'stroke'
  | 'trauma'
  | 'respiratory'
  | 'obstetric'
  | 'pediatric'
  | 'burns'
  | 'poisoning'
  | 'diabetic'
  | 'psychiatric'
  | 'other';

export type BookingStatus =
  | 'pending'
  | 'dispatching'
  | 'assigned'
  | 'accepted'
  | 'en_route_to_pickup'
  | 'arrived_at_pickup'
  | 'patient_onboard'
  | 'en_route_to_hospital'
  | 'arrived_at_hospital'
  | 'completed'
  | 'cancelled'
  | 'failed'
  | 'no_ambulance_available';

export interface ILocation {
  address: string;
  lat: number;
  lng: number;
  landmark?: string;
}

export interface IAssignmentAttempt {
  ambulanceId: mongoose.Types.ObjectId;
  driverId: mongoose.Types.ObjectId;
  attemptedAt: Date;
  result: 'accepted' | 'rejected' | 'timeout' | 'failed';
  reason?: string;
  responseTime?: number; // seconds
}

export interface IDispatchScore {
  ambulanceId: mongoose.Types.ObjectId;
  vehicleNumber: string;
  distanceKm: number;
  etaMinutes: number;
  score: number;
  reasons: string[];
}

export interface IBooking extends Document {
  _id: mongoose.Types.ObjectId;
  bookingId: string;
  patient: mongoose.Types.ObjectId;
  ambulance?: mongoose.Types.ObjectId;
  driver?: mongoose.Types.ObjectId;
  hospital?: mongoose.Types.ObjectId;
  status: BookingStatus;
  emergencyCategory: EmergencyCategory;
  emergencyDescription: string;
  requiredAmbulanceType?: string;
  requiredCapabilities: string[];
  pickupLocation: ILocation;
  destinationLocation?: ILocation;
  patientCondition?: string;
  numberOfPatients: number;
  assignmentAttempts: IAssignmentAttempt[];
  dispatchScores: IDispatchScore[];
  selectedHospitalReason?: string;
  cancellationReason?: string;
  cancelledBy?: mongoose.Types.ObjectId;
  cancellationTime?: Date;
  estimatedArrivalTime?: Date;
  actualPickupTime?: Date;
  actualHospitalArrivalTime?: Date;
  completionTime?: Date;
  requestToAssignmentTime?: number; // seconds
  assignmentToAcceptanceTime?: number;
  requestToPickupTime?: number;
  totalTripDuration?: number;
  etaAccuracyMinutes?: number;
  feedback?: mongoose.Types.ObjectId;
  priority: 'critical' | 'high' | 'medium' | 'low';
  isDemo: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const LocationSchema = new Schema<ILocation>(
  {
    address: { type: String, required: true },
    lat: { type: Number, required: true, min: -90, max: 90 },
    lng: { type: Number, required: true, min: -180, max: 180 },
    landmark: String,
  },
  { _id: false }
);

const AssignmentAttemptSchema = new Schema<IAssignmentAttempt>(
  {
    ambulanceId: { type: Schema.Types.ObjectId, ref: 'Ambulance', required: true },
    driverId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    attemptedAt: { type: Date, default: Date.now },
    result: { type: String, enum: ['accepted', 'rejected', 'timeout', 'failed'], required: true },
    reason: String,
    responseTime: Number,
  },
  { _id: false }
);

const DispatchScoreSchema = new Schema<IDispatchScore>(
  {
    ambulanceId: { type: Schema.Types.ObjectId, ref: 'Ambulance', required: true },
    vehicleNumber: { type: String, required: true },
    distanceKm: { type: Number, required: true },
    etaMinutes: { type: Number, required: true },
    score: { type: Number, required: true },
    reasons: [String],
  },
  { _id: false }
);

const BookingSchema = new Schema<IBooking>(
  {
    bookingId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    patient: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    ambulance: {
      type: Schema.Types.ObjectId,
      ref: 'Ambulance',
    },
    driver: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
    hospital: {
      type: Schema.Types.ObjectId,
      ref: 'Hospital',
    },
    status: {
      type: String,
      enum: [
        'pending', 'dispatching', 'assigned', 'accepted',
        'en_route_to_pickup', 'arrived_at_pickup', 'patient_onboard',
        'en_route_to_hospital', 'arrived_at_hospital', 'completed',
        'cancelled', 'failed', 'no_ambulance_available'
      ],
      default: 'pending',
    },
    emergencyCategory: {
      type: String,
      enum: ['cardiac_arrest', 'stroke', 'trauma', 'respiratory', 'obstetric', 'pediatric', 'burns', 'poisoning', 'diabetic', 'psychiatric', 'other'],
      required: true,
    },
    emergencyDescription: {
      type: String,
      required: [true, 'Emergency description is required'],
      maxlength: [1000, 'Description cannot exceed 1000 characters'],
    },
    requiredAmbulanceType: String,
    requiredCapabilities: {
      type: [String],
      default: [],
    },
    pickupLocation: {
      type: LocationSchema,
      required: true,
    },
    destinationLocation: LocationSchema,
    patientCondition: String,
    numberOfPatients: {
      type: Number,
      default: 1,
      min: 1,
      max: 10,
    },
    assignmentAttempts: [AssignmentAttemptSchema],
    dispatchScores: [DispatchScoreSchema],
    selectedHospitalReason: String,
    cancellationReason: String,
    cancelledBy: { type: Schema.Types.ObjectId, ref: 'User' },
    cancellationTime: Date,
    estimatedArrivalTime: Date,
    actualPickupTime: Date,
    actualHospitalArrivalTime: Date,
    completionTime: Date,
    requestToAssignmentTime: Number,
    assignmentToAcceptanceTime: Number,
    requestToPickupTime: Number,
    totalTripDuration: Number,
    etaAccuracyMinutes: Number,
    feedback: { type: Schema.Types.ObjectId, ref: 'Feedback' },
    priority: {
      type: String,
      enum: ['critical', 'high', 'medium', 'low'],
      default: 'high',
    },
    isDemo: { type: Boolean, default: false },
  },
  { timestamps: true }
);

BookingSchema.index({ patient: 1, createdAt: -1 });
BookingSchema.index({ status: 1 });
BookingSchema.index({ driver: 1, status: 1 });
BookingSchema.index({ ambulance: 1 });
BookingSchema.index({ hospital: 1 });

export const Booking = mongoose.model<IBooking>('Booking', BookingSchema);
