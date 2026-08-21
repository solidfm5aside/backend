jest.mock('@/services/match.service', () => ({
  addMatchEvent: jest.fn(),
}));

import { Request, Response } from 'express';
import { addEvent } from '@/controllers/match.controller';
import * as matchService from '@/services/match.service';

const mockedAddMatchEvent = matchService.addMatchEvent as jest.MockedFunction<
  typeof matchService.addMatchEvent
>;

describe('match event response contract', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns the correlated event id and replay marker alongside the match', async () => {
    const match = { _id: 'match-1', events: [{ _id: 'event-1' }] };
    mockedAddMatchEvent.mockResolvedValue({
      match: match as never,
      eventId: 'event-1',
      replayed: true,
    });
    const request = {
      params: { id: 'match-1' },
      body: { type: 'goal' },
      get: jest.fn().mockReturnValue('request-key'),
    } as unknown as Request;
    const response = {
      status: jest.fn(),
      json: jest.fn(),
    };
    response.status.mockReturnValue(response);
    response.json.mockReturnValue(response);

    await addEvent(request, response as unknown as Response);

    expect(mockedAddMatchEvent).toHaveBeenCalledWith(
      'match-1',
      request.body,
      'request-key'
    );
    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.json).toHaveBeenCalledWith({
      success: true,
      data: { match, eventId: 'event-1', replayed: true },
      message: 'Event request replayed successfully',
    });
  });
});
