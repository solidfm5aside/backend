import { MatchStage, MatchStatus } from '@/models/match.model';

const LEGACY_STAGE_SEQUENCE = [
  MatchStage.LEAGUE,
  MatchStage.PLAYOFF,
  MatchStage.ROUND_OF_16,
  MatchStage.QUARTER_FINALS,
  MatchStage.SEMI_FINALS,
  MatchStage.FINAL,
] as const;

const LEGACY_STAGE_MATCH_COUNTS: Partial<Record<MatchStage, number>> = {
  [MatchStage.PLAYOFF]: 8,
  [MatchStage.ROUND_OF_16]: 8,
  [MatchStage.QUARTER_FINALS]: 4,
  [MatchStage.SEMI_FINALS]: 2,
  [MatchStage.FINAL]: 1,
};

export interface LegacyWinnerSource {
  status: MatchStatus | string;
  winner?: { toString(): string } | string | null;
}

export const getNextLegacyStage = (currentStage: MatchStage): MatchStage | undefined => {
  const index = LEGACY_STAGE_SEQUENCE.indexOf(
    currentStage as (typeof LEGACY_STAGE_SEQUENCE)[number]
  );
  return index >= 0 ? LEGACY_STAGE_SEQUENCE[index + 1] : undefined;
};

export const expectedLegacyStageMatchCount = (stage: MatchStage): number | undefined =>
  LEGACY_STAGE_MATCH_COUNTS[stage];

export const assertLegacyStageGenerationAllowed = (
  currentStage: MatchStage,
  requestedStage: MatchStage,
  existingRequestedStageMatches: number
): void => {
  const expectedStage = getNextLegacyStage(currentStage);
  if (!expectedStage || requestedStage !== expectedStage) {
    throw new Error(
      expectedStage
        ? `The next legacy stage must be ${expectedStage}; ${requestedStage} cannot be generated now.`
        : `No stage can be generated after ${currentStage}.`
    );
  }
  if (existingRequestedStageMatches > 0) {
    throw new Error(`${requestedStage} fixtures have already been generated.`);
  }
};

export const assertLegacySourceStageAvailable = (
  fixturesGenerated: boolean,
  currentStage: MatchStage,
  currentStageMatchCount: number
): void => {
  if (!fixturesGenerated) {
    throw new Error('Generate the legacy league fixtures before advancing to a knockout stage.');
  }
  if (currentStageMatchCount === 0) {
    throw new Error(`The ${currentStage} stage has no fixtures and cannot be advanced.`);
  }
};

export const collectLegacyWinners = (
  matches: LegacyWinnerSource[],
  sourceStage: MatchStage
): string[] => {
  const expectedCount = expectedLegacyStageMatchCount(sourceStage);
  if (expectedCount !== undefined && matches.length !== expectedCount) {
    throw new Error(
      `Cannot advance from ${sourceStage}: expected ${expectedCount} matches but found ${matches.length}.`
    );
  }
  const incomplete = matches.filter(
    (match) => match.status !== MatchStatus.COMPLETED || !match.winner
  ).length;
  if (incomplete > 0) {
    throw new Error(
      `Cannot advance from ${sourceStage}: ${incomplete} match(es) are incomplete or have no winner set.`
    );
  }
  return matches.map((match) => String(match.winner));
};
