import mongoose, { Schema } from 'mongoose';

export interface IAdminAccessControl {
  _id: string;
  revision: number;
  lockToken?: string;
  lockedUntil?: Date;
}

const adminAccessControlSchema = new Schema<IAdminAccessControl>(
  {
    _id: { type: String, required: true },
    revision: { type: Number, default: 0, min: 0 },
    lockToken: String,
    lockedUntil: Date,
  },
  {
    versionKey: false,
  }
);

export default mongoose.model<IAdminAccessControl>(
  'AdminAccessControl',
  adminAccessControlSchema
);
