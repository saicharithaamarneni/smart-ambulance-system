import mongoose, { Document, Schema } from 'mongoose';

export type AmbulanceType = 'BLS' | 'ALS' | 'CCT' | 'NICU' | 'BARIATRIC';
export type AmbulanceStatus = 'available' | 'assigned' | 'en_route' | 'at_scene' | 'transporting' | 'maintenance' | 'offline';

export interface ICoordinates {
  lat: number;
  lng: number;
  accuracy?: number;
  heading?: number;
  speed?: number;
  timestamp: Date;
}

export interface IAmbulance extends Document {
  _id: mongoose.Types.ObjectId;
  vehicleNumber: string;
  type: AmbulanceType;
  status: AmbulanceStatus;
  driver?: mongoose.Types.ObjectId;
  currentLocation?: ICoordinates;
  lastLocationUpdate?: Date;
  capabilities: string[];
  equipment: string[];
  isOnline: boolean;
  isSimulated: boolean;
  fuelLevel?: number;
  mileage?: number;
  yearOfManufacture?: number;
  vehicleModel?: string;
  make?: string;
  insuranceExpiry?: Date;
  lastServiceDate?: Date;
  notes?: string;
  currentBooking?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}


const CoordinatesSchema = new Schema<ICoordinates>(
  {
    lat: { type: Number, required: true, min: -90, max: 90 },
    lng: { type: Number, required: true, min: -180, max: 180 },
    accuracy: { type: Number, min: 0 },
    heading: { type: Number, min: 0, max: 360 },
    speed: { type: Number, min: 0 },
    timestamp: { type: Date, required: true, default: Date.now },
  },
  { _id: false }
);

const AmbulanceSchema = new Schema<IAmbulance>(
  {
    vehicleNumber: {
      type: String,
      required: [true, 'Vehicle number is required'],
      unique: true,
      uppercase: true,
      trim: true,
    },
    type: {
      type: String,
      enum: ['BLS', 'ALS', 'CCT', 'NICU', 'BARIATRIC'],
      required: [true, 'Ambulance type is required'],
    },
    status: {
      type: String,
      enum: ['available', 'assigned', 'en_route', 'at_scene', 'transporting', 'maintenance', 'offline'],
      default: 'offline',
    },
    driver: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
    currentLocation: CoordinatesSchema,
    lastLocationUpdate: Date,
    capabilities: {
      type: [String],
      default: [],
    },
    equipment: {
      type: [String],
      default: [],
    },
    isOnline: {
      type: Boolean,
      default: false,
    },
    isSimulated: {
      type: Boolean,
      default: false,
    },
    fuelLevel: { type: Number, min: 0, max: 100 },
    mileage: { type: Number, min: 0 },
    yearOfManufacture: Number,
    vehicleModel: String,
    make: String,
    insuranceExpiry: Date,
    lastServiceDate: Date,
    notes: String,
    currentBooking: {
      type: Schema.Types.ObjectId,
      ref: 'Booking',
    },
  },
  { timestamps: true }
);

AmbulanceSchema.index({ status: 1, isOnline: 1 });
AmbulanceSchema.index({ driver: 1 });
AmbulanceSchema.index({ 'currentLocation.lat': 1, 'currentLocation.lng': 1 });

export const Ambulance = mongoose.model<IAmbulance>('Ambulance', AmbulanceSchema);
