import Tournament, { TournamentFormat } from '@/models/tournament.model';
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

  it('creates only the fixed v2 format and overwrites workflow-owned defaults', async () => {
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
        workflowState: 'setup',
        workflowRevision: 0,
        status: 'upcoming',
      })
    );
  });
});
