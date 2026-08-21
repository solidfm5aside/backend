import mongoose, { Schema, Document } from 'mongoose';

export interface ITeam extends Document {
  name: string;
  city: string;
  stadium?: string;
  colors: string[];
  logo?: string;
  foundedYear?: number;
  captainName: string;
  contactPhone: string;
  contactEmail: string;
  registrationStatus: 'pending' | 'registered' | 'withdrawn';
  lifecycleRevision: number;
  isDeleted: boolean;
}

const teamSchema = new Schema<ITeam>(
  {
    name: {
      type: String,
      required: [true, 'Team name is required'],
      trim: true,
      minlength: [3, 'Team name must be at least 3 characters'],
    },
    city: {
      type: String,
      required: [true, 'City is required'],
      trim: true,
    },
    stadium: {
      type: String,
      trim: true,
    },
    colors: {
      type: [String],
      default: [],
    },
    logo: { type: String },
    foundedYear: { type: Number },
    captainName: { 
      type: String, 
      required: [true, 'Captain/Contact name is required'],
      trim: true 
    },
    contactPhone: { 
      type: String, 
      required: [true, 'Contact phone is required'],
      trim: true 
    },
    contactEmail: { 
      type: String, 
      required: [true, 'Contact email is required'],
      trim: true,
      lowercase: true
    },
    registrationStatus: {
      type: String,
      enum: ['pending', 'registered', 'withdrawn'],
      default: 'pending',
    },
    lifecycleRevision: {
      type: Number,
      min: 0,
      default: 0,
      select: false,
    },
    isDeleted: { type: Boolean, default: false },
  },
  {
    timestamps: true,
  }
);

teamSchema.index(
  { name: 1 },
  {
    unique: true,
    name: 'one_active_team_name_case_insensitive',
    partialFilterExpression: { isDeleted: false },
    collation: { locale: 'en', strength: 2 },
  }
);

export default mongoose.model<ITeam>('Team', teamSchema);
