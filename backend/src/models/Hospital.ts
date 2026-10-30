import mongoose, { Document, Schema } from 'mongoose';

export interface IHospital extends Document {
  _id: mongoose.Types.ObjectId;
  name: string;
  address: string;
  location: { lat: number; lng: number };
  phone: string;
  email?: string;
  specialties: string[];
  facilities: string[];
  emergencyDepartment: {
    isAvailable: boolean;
    capacity: number;
    currentOccupancy: number;
  };
  icuBeds: {
    total: number;
    available: number;
  };
  generalBeds: {
    total: number;
    available: number;
  };
  staffMembers: mongoose.Types.ObjectId[];
  isActive: boolean;
  isDemo: boolean;
  capacityLastUpdated: Date;
  preArrivalNotifications: Array<{
    bookingId: mongoose.Types.ObjectId;
    notifiedAt: Date;
    condition: string;
    estimatedArrival: Date;
  }>;
  rating?: number;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const HospitalSchema = new Schema<IHospital>(
  {
    name: { type: String, required: true, trim: true },
    address: { type: String, required: true },
    location: {
      lat: { type: Number, required: true, min: -90, max: 90 },
      lng: { type: Number, required: true, min: -180, max: 180 },
    },
    phone: { type: String, required: true },
    email: String,
    specialties: { type: [String], default: [] },
    facilities: { type: [String], default: [] },
    emergencyDepartment: {
      isAvailable: { type: Boolean, default: true },
      capacity: { type: Number, min: 0, default: 20 },
      currentOccupancy: {
        type: Number,
        min: 0,
        default: 0,
        validate: {
          validator: function (this: any, v: number) {
            const cap = this?.emergencyDepartment?.capacity;
            return cap !== undefined ? v <= cap : true;
          },
          message: 'Current occupancy cannot exceed capacity',
        },
      },
    },
    icuBeds: {
      total: { type: Number, min: 0, default: 10 },
      available: {
        type: Number,
        min: 0,
        default: 5,
        validate: {
          validator: function (this: any, v: number) {
            const tot = this?.icuBeds?.total;
            return tot !== undefined ? v <= tot : true;
          },
          message: 'Available ICU beds cannot exceed total ICU beds',
        },
      },
    },
    generalBeds: {
      total: { type: Number, min: 0, default: 100 },
      available: {
        type: Number,
        min: 0,
        default: 50,
        validate: {
          validator: function (this: any, v: number) {
            const tot = this?.generalBeds?.total;
            return tot !== undefined ? v <= tot : true;
          },
          message: 'Available general beds cannot exceed total general beds',
        },
      },
    },
    staffMembers: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    isActive: { type: Boolean, default: true },
    isDemo: { type: Boolean, default: false },
    capacityLastUpdated: { type: Date, default: Date.now },
    preArrivalNotifications: [
      {
        bookingId: { type: Schema.Types.ObjectId, ref: 'Booking' },
        notifiedAt: { type: Date, default: Date.now },
        condition: String,
        estimatedArrival: Date,
        _id: false,
      },
    ],
    rating: { type: Number, min: 1, max: 5 },
    notes: String,
  },
  { timestamps: true }
);

HospitalSchema.index({ 'location.lat': 1, 'location.lng': 1 });
HospitalSchema.index({ specialties: 1 });
HospitalSchema.index({ isActive: 1 });

export const Hospital = mongoose.model<IHospital>('Hospital', HospitalSchema);
