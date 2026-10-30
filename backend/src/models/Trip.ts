import mongoose, { Document, Schema } from 'mongoose';

export type TripStatus =
  | 'assigned'
  | 'accepted'
  | 'en_route_to_pickup'
  | 'arrived_at_pickup'
  | 'patient_onboard'
  | 'en_route_to_hospital'
  | 'arrived_at_hospital'
  | 'completed';

export interface IStatusUpdate {
  status: TripStatus;
  timestamp: Date;
  location?: { lat: number; lng: number };
  note?: string;
  updatedBy: mongoose.Types.ObjectId;
}

export interface ITrip extends Document {
  _id: mongoose.Types.ObjectId;
  tripId: string;
  booking: mongoose.Types.ObjectId;
  patient: mongoose.Types.ObjectId;
  driver: mongoose.Types.ObjectId;
  ambulance: mongoose.Types.ObjectId;
  hospital?: mongoose.Types.ObjectId;
  currentStatus: TripStatus;
  statusHistory: IStatusUpdate[];
  pickupLocation: { address: string; lat: number; lng: number };
  destinationLocation?: { address: string; lat: number; lng: number };
  routePolyline?: string;
  distanceKm?: number;
  estimatedDurationMinutes?: number;
  actualDurationMinutes?: number;
  gpsTrail: Array<{
    lat: number;
    lng: number;
    timestamp: Date;
    speed?: number;
    heading?: number;
    isSimulated: boolean;
  }>;
  lastKnownLocation?: {
    lat: number;
    lng: number;
    timestamp: Date;
    isSimulated: boolean;
  };
  startedAt?: Date;
  completedAt?: Date;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

// Valid status transitions (prevents invalid transitions)
export const VALID_STATUS_TRANSITIONS: Record<TripStatus, TripStatus[]> = {
  assigned: ['accepted'],
  accepted: ['en_route_to_pickup'],
  en_route_to_pickup: ['arrived_at_pickup'],
  arrived_at_pickup: ['patient_onboard'],
  patient_onboard: ['en_route_to_hospital'],
  en_route_to_hospital: ['arrived_at_hospital'],
  arrived_at_hospital: ['completed'],
  completed: [], // No transitions from completed
};

const StatusUpdateSchema = new Schema<IStatusUpdate>(
  {
    status: {
      type: String,
      enum: ['assigned', 'accepted', 'en_route_to_pickup', 'arrived_at_pickup', 'patient_onboard', 'en_route_to_hospital', 'arrived_at_hospital', 'completed'],
      required: true,
    },
    timestamp: { type: Date, default: Date.now },
    location: {
      lat: { type: Number, min: -90, max: 90 },
      lng: { type: Number, min: -180, max: 180 },
    },
    note: String,
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { _id: false }
);

const TripSchema = new Schema<ITrip>(
  {
    tripId: { type: String, required: true, unique: true },
    booking: { type: Schema.Types.ObjectId, ref: 'Booking', required: true },
    patient: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    driver: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    ambulance: { type: Schema.Types.ObjectId, ref: 'Ambulance', required: true },
    hospital: { type: Schema.Types.ObjectId, ref: 'Hospital' },
    currentStatus: {
      type: String,
      enum: ['assigned', 'accepted', 'en_route_to_pickup', 'arrived_at_pickup', 'patient_onboard', 'en_route_to_hospital', 'arrived_at_hospital', 'completed'],
      required: true,
      default: 'assigned',
    },
    statusHistory: [StatusUpdateSchema],
    pickupLocation: {
      address: { type: String, required: true },
      lat: { type: Number, required: true },
      lng: { type: Number, required: true },
    },
    destinationLocation: {
      address: String,
      lat: Number,
      lng: Number,
    },
    routePolyline: String,
    distanceKm: Number,
    estimatedDurationMinutes: Number,
    actualDurationMinutes: Number,
    gpsTrail: [
      {
        lat: { type: Number, required: true },
        lng: { type: Number, required: true },
        timestamp: { type: Date, default: Date.now },
        speed: Number,
        heading: Number,
        isSimulated: { type: Boolean, default: false },
        _id: false,
      },
    ],
    lastKnownLocation: {
      lat: Number,
      lng: Number,
      timestamp: Date,
      isSimulated: { type: Boolean, default: false },
    },
    startedAt: Date,
    completedAt: Date,
    notes: String,
  },
  { timestamps: true }
);

TripSchema.index({ booking: 1 });
TripSchema.index({ driver: 1, currentStatus: 1 });
TripSchema.index({ patient: 1 });
TripSchema.index({ createdAt: -1 });

export const Trip = mongoose.model<ITrip>('Trip', TripSchema);
