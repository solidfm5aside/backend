import {
  appendCommitteeResolutionDecision,
  selectActiveCommitteeResolutions,
} from '@/utils/committee-resolution.util';

describe('committee resolution audit history', () => {
  it('supersedes but never erases the prior who/when/method decision', () => {
    const first = {
      decisionId: 'decision-1',
      decisionRevision: 8,
      status: 'active' as const,
      groupKey: 'A' as const,
      basisHash: 'a'.repeat(64),
      tiedTeamIds: ['team-a', 'team-b'],
      orderedTeamIds: ['team-a', 'team-b'],
      method: 'coin_toss',
      decidedBy: 'admin-1',
      decidedAt: new Date('2026-08-21T10:00:00.000Z'),
    };
    const correction = {
      ...first,
      decisionId: 'decision-2',
      decisionRevision: 9,
      orderedTeamIds: ['team-b', 'team-a'],
      method: 'draw',
      decidedBy: 'admin-2',
      decidedAt: new Date('2026-08-21T11:00:00.000Z'),
    };
    const correctedAt = new Date('2026-08-21T11:00:00.000Z');
    const history = appendCommitteeResolutionDecision([first], correction, correctedAt);

    expect(history).toHaveLength(2);
    expect(history[0]).toEqual({
      ...first,
      status: 'superseded',
      supersededAt: correctedAt,
      supersededByDecisionId: 'decision-2',
    });
    expect(history[1]).toEqual({ ...correction, status: 'active' });
    expect(selectActiveCommitteeResolutions(history)).toEqual([history[1]]);
  });
});
