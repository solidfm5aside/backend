jest.mock('@/services/venue-lifecycle.service', () => {
  const actual = jest.requireActual('@/services/venue-lifecycle.service');
  return {
    ...actual,
    updateVenueSafely: jest.fn(),
    deleteVenueSafely: jest.fn(),
  };
});

import { Request, Response } from 'express';
import { deleteVenue, updateVenue } from '@/controllers/venue.controller';
import {
  deleteVenueSafely,
  updateVenueSafely,
  VenueMutationError,
} from '@/services/venue-lifecycle.service';

const mockedUpdate = updateVenueSafely as jest.MockedFunction<typeof updateVenueSafely>;
const mockedDelete = deleteVenueSafely as jest.MockedFunction<typeof deleteVenueSafely>;

const buildResponse = () => {
  const response = { status: jest.fn(), json: jest.fn() };
  response.status.mockReturnValue(response);
  response.json.mockReturnValue(response);
  return response as unknown as Response & { status: jest.Mock; json: jest.Mock };
};

describe('venue controller mutation contract', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns the explicit confirmed-match lock for a blocked rename', async () => {
    mockedUpdate.mockRejectedValue(
      new VenueMutationError(
        'This venue name is locked because a confirmed match already references it.',
        409,
        'VENUE_REFERENCED_BY_CONFIRMED_MATCH'
      )
    );
    const response = buildResponse();
    await updateVenue(
      { params: { id: '507f1f77bcf86cd799439011' }, body: { name: 'New name' } } as unknown as Request,
      response
    );
    expect(response.status).toHaveBeenCalledWith(409);
    expect(response.json).toHaveBeenCalledWith({
      success: false,
      message: 'This venue name is locked because a confirmed match already references it.',
      code: 'VENUE_REFERENCED_BY_CONFIRMED_MATCH',
    });
  });

  it('returns the explicit confirmed-match lock for a blocked deletion', async () => {
    mockedDelete.mockRejectedValue(
      new VenueMutationError(
        'This venue cannot be deleted because a confirmed match references it.',
        409,
        'VENUE_REFERENCED_BY_CONFIRMED_MATCH'
      )
    );
    const response = buildResponse();
    await deleteVenue(
      { params: { id: '507f1f77bcf86cd799439011' } } as unknown as Request,
      response
    );
    expect(response.status).toHaveBeenCalledWith(409);
    expect(response.json).toHaveBeenCalledWith({
      success: false,
      message: 'This venue cannot be deleted because a confirmed match references it.',
      code: 'VENUE_REFERENCED_BY_CONFIRMED_MATCH',
    });
  });
});
