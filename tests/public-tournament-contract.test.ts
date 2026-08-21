import { PUBLIC_TOURNAMENT_FIELDS } from '@/services/tournament.service';

describe('public tournament list contract', () => {
  it('uses an explicit useful allow-list without committee or internal workflow audit state', () => {
    const fields = new Set(PUBLIC_TOURNAMENT_FIELDS.split(' '));

    expect([...fields]).toEqual(
      expect.arrayContaining([
        'name',
        'season',
        'startDate',
        'status',
        'currentStage',
        'formatVersion',
        'format',
      ])
    );
    expect(fields.has('competitionTieResolutions')).toBe(false);
    expect(fields.has('qualificationSnapshot')).toBe(false);
    expect(fields.has('workflowRevision')).toBe(false);
    expect(fields.has('entryIdentityRevision')).toBe(false);
    expect(fields.has('rosterIdentityRevision')).toBe(false);
    expect(fields.has('standingsRevision')).toBe(false);
  });
});
