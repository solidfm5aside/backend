import mongoose, { Schema, Document } from 'mongoose';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import {
  ADMIN_BOOTSTRAP_CLAIM,
  ADMIN_BOOTSTRAP_INDEX,
} from '@/utils/admin-bootstrap.util';

export enum AdminRole {
  SUPER_ADMIN = 'super_admin',
  ADMIN = 'admin',
  VIEWER = 'viewer',
}

export interface IAdmin extends Document {
  name: string;
  email: string;
  password: string;
  role: AdminRole;
  lastLogin?: Date;
  isVerified: boolean;
  isDeleted: boolean;
  passwordChangedAt?: Date;
  passwordResetToken?: string;
  passwordResetExpires?: Date;
  sessionVersion: number;
  bootstrapClaim?: typeof ADMIN_BOOTSTRAP_CLAIM;
  comparePassword(password: string): Promise<boolean>;
  createPasswordResetToken(): string;
}

const adminSchema = new Schema<IAdmin>(
  {
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
      minlength: [2, 'Name must be at least 2 characters'],
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, 'Please use a valid email address'],
    },
    password: {
      type: String,
      required: [true, 'Password is required'],
      minlength: [8, 'Password must be at least 8 characters'],
      select: false,
    },
    role: {
      type: String,
      enum: Object.values(AdminRole),
      default: AdminRole.VIEWER,
    },
    isVerified: {
      type: Boolean,
      default: false,
    },
    lastLogin: {
      type: Date,
    },
    isDeleted: {
      type: Boolean,
      default: false,
    },
    passwordChangedAt: Date,
    passwordResetToken: String,
    passwordResetExpires: Date,
    sessionVersion: {
      type: Number,
      min: 0,
      default: 0,
    },
    bootstrapClaim: {
      type: String,
      enum: [ADMIN_BOOTSTRAP_CLAIM],
      immutable: true,
      select: false,
    },
  },
  {
    timestamps: true,
  }
);

adminSchema.index(
  { bootstrapClaim: 1 },
  {
    unique: true,
    name: ADMIN_BOOTSTRAP_INDEX,
    partialFilterExpression: { bootstrapClaim: { $type: 'string' } },
  }
);
adminSchema.index({ role: 1, isVerified: 1, isDeleted: 1 });

// Method to create password reset token
adminSchema.methods.createPasswordResetToken = function () {
  const resetToken = crypto.randomBytes(32).toString('hex');

  this.passwordResetToken = crypto
    .createHash('sha256')
    .update(resetToken)
    .digest('hex');

  this.passwordResetExpires = Date.now() + 10 * 60 * 1000; // 10 minutes

  return resetToken;
};

// Password hashing
adminSchema.pre<IAdmin>('save', async function () {
  if (!this.isModified('password')) return;
  try {
    const salt = await bcrypt.genSalt(Number(process.env.SALT_ROUNDS) || 10);
    this.password = await bcrypt.hash(this.password, salt);
  } catch (error) {
    throw error;
  }
});

// Compare password method
adminSchema.methods.comparePassword = async function (password: string): Promise<boolean> {
  return bcrypt.compare(password, this.password);
};

export default mongoose.model<IAdmin>('Admin', adminSchema);
