import Tournament, {
  FIXED_WOMENS_COMPETITION_RULES,
  TournamentFormat,
} from '@/models/tournament.model';
import { CompetitionDivision } from '@/models/competition-division';
import {
  createTournament,
  TournamentMutationError,
} from '@/services/tournament.service';

describe('fixed competition format creation guard', () => {
  afterEach(() => jest.restoreAllMocks());

  it('fails closed in the service when a stale caller omits format fields', async () => {
    const create = jest.spyOn(Tournament, 'create');

    await expect(
      createTournament({
        name: 'Solid FM Cup',
        season: '2026',
        startDate: new Date('2026-09-01T00:00:00.000Z'),
      })
    ).rejects.toMatchObject<Partial<TournamentMutationError>>({
      code: 'FIXED_COMPETITION_FORMAT_REQUIRED',
      statusCode: 400,
    });
    expect(create).not.toHaveBeenCalled();
  });

  it('preserves the fixed men v2 format and overwrites workflow-owned defaults', async () => {
    const created = { _id: 'tournament-1' };
    const create = jest.spyOn(Tournament, 'create').mockResolvedValue(created as never);

    await expect(
      createTournament({
        name: ' Solid FM Cup ',
        season: ' 2026 ',
        startDate: new Date('2026-09-01T00:00:00.000Z'),
        formatVersion: 2,
        format: TournamentFormat.TWO_GROUP_KNOCKOUT,
        status: 'completed',
      })
    ).resolves.toBe(created);

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Solid FM Cup',
        season: '2026',
        formatVersion: 2,
        format: TournamentFormat.TWO_GROUP_KNOCKOUT,
        division: CompetitionDivision.MEN,
        workflowState: 'setup',
        workflowRevision: 0,
        status: 'upcoming',
      })
    );
  });

  it('creates the separate fixed women v3 single-table-to-final format', async () => {
    const created = { _id: 'women-tournament-1' };
    const create = jest.spyOn(Tournament, 'create').mockResolvedValue(created as never);

    await expect(
      createTournament({
        name: ' Solid FM Women Cup ',
        season: ' 2026 ',
        startDate: new Date('2026-09-01T00:00:00.000Z'),
        formatVersion: 3,
        format: TournamentFormat.SINGLE_TABLE_FINAL,
        division: CompetitionDivision.WOMEN,
      })
    ).resolves.toBe(created);

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Solid FM Women Cup',
        season: '2026',
        formatVersion: 3,
        format: TournamentFormat.SINGLE_TABLE_FINAL,
        division: CompetitionDivision.WOMEN,
        workflowState: 'setup',
        currentStage: 'league',
        leagueRounds: 3,
        fixturesGenerated: false,
        competitionRules: expect.objectContaining(FIXED_WOMENS_COMPETITION_RULES),
      })
    );
  });

  it('rejects cross-division format combinations', async () => {
    const create = jest.spyOn(Tournament, 'create');
    const base = {
      name: 'Wrong Division Cup',
      season: '2026',
      startDate: new Date('2026-09-01T00:00:00.000Z'),
    };

    await expect(
      createTournament({
        ...base,
        formatVersion: 3,
        format: TournamentFormat.SINGLE_TABLE_FINAL,
        division: CompetitionDivision.MEN,
      })
    ).rejects.toMatchObject({ code: 'FIXED_COMPETITION_FORMAT_REQUIRED' });
    await expect(
      createTournament({
        ...base,
        formatVersion: 2,
        format: TournamentFormat.TWO_GROUP_KNOCKOUT,
        division: CompetitionDivision.WOMEN,
      })
    ).rejects.toMatchObject({ code: 'FIXED_COMPETITION_FORMAT_REQUIRED' });
    expect(create).not.toHaveBeenCalled();
  });
});
