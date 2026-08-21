import { buildCompetitionEntryIdentityUpdate } from '@/utils/competition-entry-identity.util';

describe('open competition entry identity snapshots', () => {
  it('refreshes the future archive snapshot after an open-season rename/logo correction', () => {
    expect(
      buildCompetitionEntryIdentityUpdate({
        name: '  Corrected Team Name  ',
        logo: 'new-logo.png',
      })
    ).toEqual({
      $set: {
        teamNameSnapshot: 'Corrected Team Name',
        teamLogoSnapshot: 'new-logo.png',
      },
    });
  });

  it('explicitly removes an obsolete snapshot logo', () => {
    expect(buildCompetitionEntryIdentityUpdate({ name: 'Corrected Team Name' })).toEqual({
      $set: { teamNameSnapshot: 'Corrected Team Name' },
      $unset: { teamLogoSnapshot: 1 },
    });
  });
});
