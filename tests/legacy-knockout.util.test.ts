import { MatchStage, MatchStatus } from '@/models/match.model';
import {
  assertLegacySourceStageAvailable,
  assertLegacyStageGenerationAllowed,
  collectLegacyWinners,
} from '@/utils/legacy-knockout.util';

describe('legacy knockout progression integrity', () => {
  it('allows only the exact adjacent stage and rejects duplicates or skips', () => {
    expect(() =>
      assertLegacyStageGenerationAllowed(MatchStage.PLAYOFF, MatchStage.ROUND_OF_16, 0)
    ).not.toThrow();
    expect(() =>
      assertLegacyStageGenerationAllowed(MatchStage.PLAYOFF, MatchStage.QUARTER_FINALS, 0)
    ).toThrow(/next legacy stage must be round_of_16/i);
    expect(() =>
      assertLegacyStageGenerationAllowed(MatchStage.PLAYOFF, MatchStage.ROUND_OF_16, 8)
    ).toThrow(/already been generated/i);
  });

  it('cannot skip league fixture generation or advance an empty current stage', () => {
    expect(() =>
      assertLegacySourceStageAvailable(false, MatchStage.LEAGUE, 0)
    ).toThrow(/generate the legacy league fixtures/i);
    expect(() =>
      assertLegacySourceStageAvailable(true, MatchStage.LEAGUE, 0)
    ).toThrow(/has no fixtures/i);
    expect(() =>
      assertLegacySourceStageAvailable(true, MatchStage.LEAGUE, 24)
    ).not.toThrow();
  });

  it('uses the stored playoff winner when a tied match was decided by penalties', () => {
    const matches = Array.from({ length: 8 }, (_, index) => ({
      status: MatchStatus.COMPLETED,
      winner: index === 0 ? 'away-team-won-on-pens' : `winner-${index + 1}`,
    }));

    expect(collectLegacyWinners(matches, MatchStage.PLAYOFF)[0]).toBe(
      'away-team-won-on-pens'
    );
  });

  it('requires the natural predecessor match count and an explicit winner for every match', () => {
    expect(() =>
      collectLegacyWinners(
        Array.from({ length: 7 }, (_, index) => ({
          status: MatchStatus.COMPLETED,
          winner: `winner-${index}`,
        })),
        MatchStage.PLAYOFF
      )
    ).toThrow(/expected 8 matches/i);

    expect(() =>
      collectLegacyWinners(
        Array.from({ length: 8 }, (_, index) => ({
          status: MatchStatus.COMPLETED,
          winner: index === 7 ? undefined : `winner-${index}`,
        })),
        MatchStage.PLAYOFF
      )
    ).toThrow(/no winner/i);
  });
});
