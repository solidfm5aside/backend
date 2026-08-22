import mongoose, { Types } from 'mongoose';
import Match, { MatchScheduleStatus } from '@/models/match.model';
import Venue from '@/models/venue.model';
import {
  deleteVenueSafely,
  fenceActiveVenueNames,
  updateVenueSafely,
} from '@/services/venue-lifecycle.service';

const queryResult = <T>(value: T) => {
  const promise = Promise.resolve(value);
  const query = {
    select: jest.fn(),
    session: jest.fn(),
    lean: jest.fn().mockResolvedValue(value),
    then: promise.then.bind(promise),
    catch: promise.catch.bind(promise),
  };
  query.select.mockReturnValue(query);
  query.session.mockReturnValue(query);
  return query;
};

const buildSession = () => ({
  withTransaction: jest.fn(async (operation: () => Promise<void>) => operation()),
  endSession: jest.fn().mockResolvedValue(undefined),
});

describe('confirmed-match venue lifecycle fences', () => {
  afterEach(() => jest.restoreAllMocks());

  it('blocks a case-insensitive rename when a confirmed match references the venue', async () => {
    const session = buildSession();
    jest.spyOn(mongoose, 'startSession').mockResolvedValue(session as never);
    const venue = { _id: new Types.ObjectId(), name: 'Eclipse Arena', __v: 3 };
    jest.spyOn(Venue, 'findOne').mockReturnValue(queryResult(venue) as never);
    const exists = jest.spyOn(Match, 'exists').mockReturnValue(
      queryResult({ _id: new Types.ObjectId() }) as never
    );
    const update = jest.spyOn(Venue, 'findOneAndUpdate');

    await expect(
      updateVenueSafely(venue._id.toString(), { name: 'New Eclipse Arena' })
    ).rejects.toMatchObject({
      code: 'VENUE_REFERENCED_BY_CONFIRMED_MATCH',
      statusCode: 409,
    });
    expect(exists).toHaveBeenCalledWith(
      expect.objectContaining({
        isDeleted: false,
        scheduleStatus: MatchScheduleStatus.CONFIRMED,
        venue: { $regex: '^Eclipse Arena$', $options: 'i' },
      })
    );
    expect(update).not.toHaveBeenCalled();
  });

  it('blocks deletion when a confirmed match references the venue', async () => {
    const session = buildSession();
    jest.spyOn(mongoose, 'startSession').mockResolvedValue(session as never);
    const venue = { _id: new Types.ObjectId(), name: 'Wembley Hotel', __v: 1 };
    jest.spyOn(Venue, 'findOne').mockReturnValue(queryResult(venue) as never);
    jest.spyOn(Match, 'exists').mockReturnValue(
      queryResult({ _id: new Types.ObjectId() }) as never
    );
    const update = jest.spyOn(Venue, 'findOneAndUpdate');

    await expect(deleteVenueSafely(venue._id.toString())).rejects.toMatchObject({
      code: 'VENUE_REFERENCED_BY_CONFIRMED_MATCH',
      statusCode: 409,
    });
    expect(update).not.toHaveBeenCalled();
  });

  it('allows non-name edits and persists them through the shared venue version fence', async () => {
    const session = buildSession();
    jest.spyOn(mongoose, 'startSession').mockResolvedValue(session as never);
    const venue = { _id: new Types.ObjectId(), name: 'Tribu Arena', __v: 7 };
    const updated = { ...venue, address: 'Updated address', importance: 2, __v: 8 };
    jest.spyOn(Venue, 'findOne').mockReturnValue(queryResult(venue) as never);
    const exists = jest.spyOn(Match, 'exists');
    const update = jest
      .spyOn(Venue, 'findOneAndUpdate')
      .mockResolvedValue(updated as never);

    await expect(
      updateVenueSafely(venue._id.toString(), {
        address: 'Updated address',
        importance: 2,
      })
    ).resolves.toBe(updated);
    expect(exists).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(
      { _id: venue._id, isDeleted: false, __v: 7 },
      {
        $set: { address: 'Updated address', importance: 2 },
        $inc: { __v: 1 },
      },
      { new: true, runValidators: true, session }
    );
  });

  it('allows an unreferenced rename but fails closed on a concurrent venue change', async () => {
    const firstSession = buildSession();
    jest.spyOn(mongoose, 'startSession').mockResolvedValue(firstSession as never);
    const venue = { _id: new Types.ObjectId(), name: 'Old Arena', __v: 2 };
    jest.spyOn(Venue, 'findOne').mockReturnValue(queryResult(venue) as never);
    jest.spyOn(Match, 'exists').mockReturnValue(queryResult(null) as never);
    jest.spyOn(Venue, 'findOneAndUpdate').mockResolvedValue(null);

    await expect(
      updateVenueSafely(venue._id.toString(), { name: 'Official Arena' })
    ).rejects.toMatchObject({ code: 'VENUE_UPDATE_CONFLICT', statusCode: 409 });
  });

  it('fences each distinct confirmed venue exactly once in deterministic name order', async () => {
    const session = buildSession();
    const alpha = { _id: new Types.ObjectId(), name: 'Alpha Arena', __v: 5 };
    const zulu = { _id: new Types.ObjectId(), name: 'Zulu Arena', __v: 2 };
    jest.spyOn(Venue, 'find').mockReturnValue(queryResult([zulu, alpha]) as never);
    const update = jest
      .spyOn(Venue, 'updateOne')
      .mockResolvedValue({ modifiedCount: 1 } as never);

    await expect(
      fenceActiveVenueNames(
        ['zulu arena', ' Alpha Arena ', 'ALPHA ARENA'],
        session as never
      )
    ).resolves.toEqual(
      new Map([
        ['alpha arena', 'Alpha Arena'],
        ['zulu arena', 'Zulu Arena'],
      ])
    );
    expect(update.mock.calls.map((call) => call[0])).toEqual([
      { _id: alpha._id, name: alpha.name, isDeleted: false, __v: 5 },
      { _id: zulu._id, name: zulu.name, isDeleted: false, __v: 2 },
    ]);
  });

  it('fails the publication fence when a venue disappears or its version changes', async () => {
    const session = buildSession();
    const venue = { _id: new Types.ObjectId(), name: 'Eclipse Arena', __v: 4 };
    jest.spyOn(Venue, 'find').mockReturnValue(queryResult([venue]) as never);
    jest
      .spyOn(Venue, 'updateOne')
      .mockResolvedValue({ modifiedCount: 0 } as never);
    await expect(
      fenceActiveVenueNames(['Eclipse Arena'], session as never)
    ).rejects.toMatchObject({ code: 'VENUE_PUBLICATION_CONFLICT', statusCode: 409 });

    jest.restoreAllMocks();
    jest.spyOn(Venue, 'find').mockReturnValue(queryResult([]) as never);
    await expect(
      fenceActiveVenueNames(['Deleted Arena'], session as never)
    ).rejects.toMatchObject({ code: 'CONFIRMED_VENUE_NOT_ACTIVE', statusCode: 409 });
  });
});
