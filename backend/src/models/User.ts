import mongoose, { Document, Schema } from 'mongoose';
import bcrypt from 'bcryptjs';

export type UserRole = 'patient' | 'driver' | 'hospital_staff' | 'admin';

export interface IUser extends Document {
  _id: mongoose.Types.ObjectId;
  name: string;
  email: string;
  password: string;
  phone: string;
  role: UserRole;
  isActive: boolean;
  profileImage?: string;
  address?: string;
  dateOfBirth?: Date;
  bloodGroup?: string;
  emergencyContact?: {
    name: string;
    phone: string;
    relationship: string;
  };
  medicalHistory?: string[];
  lastLogin?: Date;
  createdAt: Date;
  updatedAt: Date;
  comparePassword(candidatePassword: string): Promise<boolean>;
}

const UserSchema = new Schema<IUser>(
  {
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
      minlength: [2, 'Name must be at least 2 characters'],
      maxlength: [100, 'Name cannot exceed 100 characters'],
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, 'Please enter a valid email'],
    },
    password: {
      type: String,
      required: [true, 'Password is required'],
      minlength: [6, 'Password must be at least 6 characters'],
      select: false,
    },
    phone: {
      type: String,
      required: [true, 'Phone number is required'],
      trim: true,
      match: [/^\+?[0-9]{10,15}$/, 'Please enter a valid phone number'],
    },
    role: {
      type: String,
      enum: ['patient', 'driver', 'hospital_staff', 'admin'],
      required: [true, 'Role is required'],
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    profileImage: String,
    address: String,
    dateOfBirth: Date,
    bloodGroup: {
      type: String,
      enum: ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', ''],
    },
    emergencyContact: {
      name: String,
      phone: String,
      relationship: String,
    },
    medicalHistory: [String],
    lastLogin: Date,
  },
  {
    timestamps: true,
    toJSON: {
      transform: (_doc: any, ret: any) => {
        delete ret.password;
        return ret;
      },
    },
  }
);

// Index for fast lookups
UserSchema.index({ role: 1, isActive: 1 });

// Hash password before saving
UserSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  const salt = await bcrypt.genSalt(12);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// Compare password method
UserSchema.methods.comparePassword = async function (candidatePassword: string): Promise<boolean> {
  return bcrypt.compare(candidatePassword, this.password);
};

export const User = mongoose.model<IUser>('User', UserSchema);
