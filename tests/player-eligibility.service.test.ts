jest.mock('@/models/tournament-roster-entry.model', () => ({
  __esModule: true,
  default: { find: jest.fn() },
}));

jest.mock('@/models/tournament-entry.model', () => {
  const actual = jest.requireActual('@/models/tournament-entry.model');
  return { __esModule: true, ...actual, default: { find: jest.fn() } };
});

jest.mock('@/models/tournament.model', () => {
  const actual = jest.requireActual('@/models/tournament.model');
  return { __esModule: true, ...actual, default: { find: jest.fn() } };
});

import TournamentRosterEntry from '@/models/tournament-roster-entry.model';
import TournamentEntry from '@/models/tournament-entry.model';
import Tournament from '@/models/tournament.model';
import { getOpenPublishedCompetitionsExcludingPlayer } from '@/services/player-eligibility.service';

const TEAM_ID = '507f1f77bcf86cd799439011';
const PLAYER_ID = '507f1f77bcf86cd799439012';
const TOURNAMENT_ID = '507f1f77bcf86cd799439013';

const mockedRosterEntry = TournamentRosterEntry as unknown as { find: jest.Mock };
const mockedTournamentEntry = TournamentEntry as unknown as { find: jest.Mock };
const mockedTournament = Tournament as unknown as { find: jest.Mock };

const objectIdLike = (value: string) => ({ toString: () => value });

describe('player creation and fixture-publication ordering', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedTournamentEntry.find.mockReturnValue({
      distinct: jest.fn().mockResolvedValue([objectIdLike(TOURNAMENT_ID)]),
    });
    mockedTournament.find.mockReturnValue({
      select: jest.fn().mockReturnValue({
        sort: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue([
            {
              _id: objectIdLike(TOURNAMENT_ID),
              name: 'Solid FM Cup',
              season: '2026',
              workflowState: 'group_stage',
            },
          ]),
        }),
      }),
    });
  });

  it('reports create-first as included when publication captured the committed player', async () => {
    mockedRosterEntry.find.mockReturnValue({
      distinct: jest.fn().mockResolvedValue([objectIdLike(TOURNAMENT_ID)]),
    });

    await expect(
      getOpenPublishedCompetitionsExcludingPlayer(TEAM_ID, PLAYER_ID)
    ).resolves.toEqual([]);
    expect(mockedRosterEntry.find).toHaveBeenCalledWith({
      tournamentId: { $in: [TOURNAMENT_ID] },
      teamId: TEAM_ID,
      playerId: PLAYER_ID,
    });
  });

  it('reports publish-first as future-only when the committed roster omitted the player', async () => {
    mockedRosterEntry.find.mockReturnValue({
      distinct: jest.fn().mockResolvedValue([]),
    });

    await expect(
      getOpenPublishedCompetitionsExcludingPlayer(TEAM_ID, PLAYER_ID)
    ).resolves.toEqual([
      {
        tournamentId: TOURNAMENT_ID,
        name: 'Solid FM Cup',
        season: '2026',
        workflowState: 'group_stage',
      },
    ]);
  });
});
