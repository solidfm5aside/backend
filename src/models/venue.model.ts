import mongoose, { Schema, Document } from 'mongoose';

export interface IVenue extends Document {
  name: string;
  address: string;
  importance: number;
  isDeleted: boolean;
}

const venueSchema = new Schema<IVenue>(
  {
    name: {
      type: String,
      required: [true, 'Venue name is required'],
      trim: true,
      unique: true,
    },
    address: {
      type: String,
      required: [true, 'Venue address is required'],
    },
    importance: {
      type: Number,
      required: true,
      default: 1, // 1 is highest priority
    },
    isDeleted: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes
venueSchema.index({ importance: 1 });

export default mongoose.model<IVenue>('Venue', venueSchema);
