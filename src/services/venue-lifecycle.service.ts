import mongoose, { ClientSession, Types } from 'mongoose';
import Match, { MatchScheduleStatus } from '@/models/match.model';
import Venue from '@/models/venue.model';

export class VenueMutationError extends Error {
  constructor(
    message: string,
    public readonly statusCode = 400,
    public readonly code = 'VENUE_MUTATION_ERROR'
  ) {
    super(message);
    this.name = 'VenueMutationError';
  }
}

interface VenueUpdateInput {
  name?: string;
  address?: string;
  importance?: number;
}

const escapeRegex = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const assertVenueId = (venueId: string): void => {
  if (!Types.ObjectId.isValid(venueId)) {
    throw new VenueMutationError('Invalid venue ID', 400, 'INVALID_VENUE_ID');
  }
};

const confirmedMatchUsesVenue = async (
  venueName: string,
  session: ClientSession
): Promise<boolean> =>
  Boolean(
    await Match.exists({
      isDeleted: false,
      scheduleStatus: MatchScheduleStatus.CONFIRMED,
      venue: {
        $regex: `^${escapeRegex(venueName.trim())}$`,
        $options: 'i',
      },
    }).session(session)
  );

export const fenceActiveVenueNames = async (
  venueNames: Iterable<string>,
  session: ClientSession
): Promise<Map<string, string>> => {
  const requestedKeys = [
    ...new Set(
      [...venueNames].map((name) => name.trim().toLocaleLowerCase()).filter(Boolean)
    ),
  ].sort((left, right) => left.localeCompare(right));
  if (requestedKeys.length === 0) return new Map();

  const activeVenues = await Venue.find({ isDeleted: false })
    .select('name __v')
    .session(session)
    .lean();
  const venuesByKey = new Map<string, Array<(typeof activeVenues)[number]>>();
  for (const venue of activeVenues) {
    const key = venue.name.trim().toLocaleLowerCase();
    const matches = venuesByKey.get(key) ?? [];
    matches.push(venue);
    venuesByKey.set(key, matches);
  }

  const canonicalNames = new Map<string, string>();
  for (const key of requestedKeys) {
    const matches = venuesByKey.get(key) ?? [];
    if (matches.length !== 1) {
      throw new VenueMutationError(
        matches.length === 0
          ? 'A confirmed fixture must use an active venue.'
          : 'The requested venue identity is ambiguous.',
        409,
        matches.length === 0 ? 'CONFIRMED_VENUE_NOT_ACTIVE' : 'VENUE_IDENTITY_AMBIGUOUS'
      );
    }
    const venue = matches[0];
    const fence = await Venue.updateOne(
      {
        _id: venue._id,
        name: venue.name,
        isDeleted: false,
        __v: venue.__v ?? 0,
      },
      { $inc: { __v: 1 } },
      { session }
    );
    if (fence.modifiedCount !== 1) {
      throw new VenueMutationError(
        'A confirmed fixture venue changed during publication. Refresh and retry.',
        409,
        'VENUE_PUBLICATION_CONFLICT'
      );
    }
    canonicalNames.set(key, venue.name.trim());
  }
  return canonicalNames;
};

const runVenueTransaction = async <T>(
  work: (session: ClientSession) => Promise<T>
): Promise<T> => {
  const session = await mongoose.startSession();
  let result: T | undefined;
  try {
    await session.withTransaction(async () => {
      result = await work(session);
    });
    if (result === undefined) {
      throw new VenueMutationError(
        'Venue transaction completed without a result',
        409,
        'VENUE_TRANSACTION_INCOMPLETE'
      );
    }
    return result;
  } finally {
    await session.endSession();
  }
};

export const updateVenueSafely = async (
  venueId: string,
  input: VenueUpdateInput
) => {
  assertVenueId(venueId);
  return runVenueTransaction(async (session) => {
    const venue = await Venue.findOne({ _id: venueId, isDeleted: false }).session(session);
    if (!venue) return null;

    const requestedName = input.name?.trim();
    const nameChanges = requestedName !== undefined && requestedName !== venue.name;
    if (nameChanges && (await confirmedMatchUsesVenue(venue.name, session))) {
      throw new VenueMutationError(
        'This venue name is locked because a confirmed match already references it.',
        409,
        'VENUE_REFERENCED_BY_CONFIRMED_MATCH'
      );
    }

    const set: VenueUpdateInput = { ...input };
    if (requestedName !== undefined) set.name = requestedName;
    const updated = await Venue.findOneAndUpdate(
      {
        _id: venue._id,
        isDeleted: false,
        __v: venue.__v ?? 0,
      },
      { $set: set, $inc: { __v: 1 } },
      { new: true, runValidators: true, session }
    );
    if (!updated) {
      throw new VenueMutationError(
        'Venue changed during this update. Refresh and retry.',
        409,
        'VENUE_UPDATE_CONFLICT'
      );
    }
    return updated;
  });
};

export const deleteVenueSafely = async (venueId: string) => {
  assertVenueId(venueId);
  return runVenueTransaction(async (session) => {
    const venue = await Venue.findOne({ _id: venueId, isDeleted: false }).session(session);
    if (!venue) return null;
    if (await confirmedMatchUsesVenue(venue.name, session)) {
      throw new VenueMutationError(
        'This venue cannot be deleted because a confirmed match references it.',
        409,
        'VENUE_REFERENCED_BY_CONFIRMED_MATCH'
      );
    }
    const deleted = await Venue.findOneAndUpdate(
      {
        _id: venue._id,
        isDeleted: false,
        __v: venue.__v ?? 0,
      },
      { $set: { isDeleted: true }, $inc: { __v: 1 } },
      { new: true, runValidators: true, session }
    );
    if (!deleted) {
      throw new VenueMutationError(
        'Venue changed during deletion. Refresh and retry.',
        409,
        'VENUE_DELETE_CONFLICT'
      );
    }
    return deleted;
  });
};
