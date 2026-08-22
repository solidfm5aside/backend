import { createHash } from 'crypto';

export type SupportedTieBreaker =
  | 'points'
  | 'goal_difference'
  | 'goals_for'
  | 'head_to_head'
  | 'committee_decision';
export type SupportedDrawMode = 'manual' | 'random' | 'seeded_cross_group';

export interface CompetitionRulesLike {
  roundRobinLegs?: 1 | 2 | null;
  qualifiersPerGroup?: number | null;
  tieBreakers?: SupportedTieBreaker[] | null;
  drawMode?: SupportedDrawMode | null;
  avoidSameGroupFirstRound?: boolean | null;
  thirdPlaceMatch?: boolean | null;
  maxRosterPlayers?: number | null;
}

export interface ComparableStanding {
  points: number;
  goalDifference: number;
  goalsFor: number;
  groupSlot?: number;
}

export interface RankedStanding extends ComparableStanding {
  rank: number;
}

export interface HeadToHeadMatchLike {
  homeTeamId: string;
  awayTeamId: string;
  homeScore: number;
  awayScore: number;
  fixtureKey?: string;
}

export interface CommitteeResolutionLike {
  groupKey: 'A' | 'B';
  basisHash: string;
  tiedTeamIds: string[];
  orderedTeamIds: string[];
  method?: string;
  note?: string;
  decidedAt?: Date | string;
}

export interface HeadToHeadStanding {
  teamId: string;
  played: number;
  points: number;
  goalDifference: number;
  goalsFor: number;
  goalsAgainst: number;
}

export interface CompetitionTieCluster {
  groupKey: 'A' | 'B';
  basisHash: string;
  startRank: number;
  endRank: number;
  teamIds: string[];
  affectsQualificationOrSeeding: boolean;
  headToHead: HeadToHeadStanding[];
  resolved: boolean;
  orderedTeamIds?: string[];
  method?: string;
  note?: string;
  decidedAt?: Date | string;
}

export interface FixedCompetitionRanking<T extends ComparableStanding> {
  rows: Array<T & RankedStanding>;
  ties: CompetitionTieCluster[];
  unresolvedTies: CompetitionTieCluster[];
}

export const buildStandingRankPersistenceRows = <T extends RankedStanding>(
  rows: T[],
  teamIdOf: (row: T) => string
): Array<{ teamId: string; rank: number; row: T }> =>
  rows.map((row) => ({ teamId: teamIdOf(row), rank: row.rank, row }));

export const nextStandingsRevision = (
  currentStandingsRevision: number | null | undefined,
  workflowRevision: number | null | undefined
): number => Math.max(currentStandingsRevision ?? 0, workflowRevision ?? 0) + 1;

export const buildStandingsRevisionGuard = (incomingRevision: number) => ({
  $or: [
    { revision: { $exists: false } },
    { revision: { $lte: incomingRevision } },
  ],
});

export interface CompetitionPlayerStatsEventLike {
  type: string;
  playerId?: unknown;
  teamId: unknown;
  assistPlayerId?: unknown;
}

export interface CompetitionPlayerStatsMatchLike {
  status: string;
  events: CompetitionPlayerStatsEventLike[];
}

export interface CompetitionPlayerStatsSnapshotRow {
  playerId: string;
  teamId: string;
  goals: number;
  assists: number;
  yellowCards: number;
  redCards: number;
  matchesPlayed: number;
}

/**
 * Builds the complete v2 player-stat cache from one transactional match
 * snapshot. Callers replace every older revision, so removed/corrected events
 * cannot leave stale player rows behind.
 */
export const buildCompetitionPlayerStatsSnapshot = (
  matches: CompetitionPlayerStatsMatchLike[]
): CompetitionPlayerStatsSnapshotRow[] => {
  const rows = new Map<
    string,
    Omit<CompetitionPlayerStatsSnapshotRow, 'playerId'>
  >();
  const rowFor = (playerId: string, teamId: string) => {
    const existing = rows.get(playerId) ?? {
      teamId,
      goals: 0,
      assists: 0,
      yellowCards: 0,
      redCards: 0,
      matchesPlayed: 0,
    };
    rows.set(playerId, existing);
    return existing;
  };

  for (const match of matches) {
    if (match.status !== 'live' && match.status !== 'completed') continue;
    for (const event of match.events) {
      if (!event.playerId) continue;
      const playerId = String(event.playerId);
      const teamId = String(event.teamId);
      const stats = rowFor(playerId, teamId);
      if (event.type === 'goal') {
        stats.goals++;
        if (event.assistPlayerId) {
          rowFor(String(event.assistPlayerId), teamId).assists++;
        }
      } else if (event.type === 'yellow_card') {
        stats.yellowCards++;
      } else if (event.type === 'red_card') {
        stats.redCards++;
      }
    }
  }

  return [...rows.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([playerId, row]) => ({ playerId, ...row }));
};

export interface CompetitionTeamIdentityLike {
  name: string;
  logo?: string;
}

export const selectCompetitionTeamIdentity = (
  snapshot: CompetitionTeamIdentityLike,
  current: CompetitionTeamIdentityLike | undefined,
  competitionCompleted: boolean
): CompetitionTeamIdentityLike =>
  competitionCompleted || !current
    ? { name: snapshot.name, logo: snapshot.logo }
    : { name: current.name, logo: current.logo };

export const withBracketNodeTeamIdentities = <T extends object>(
  match: T | null | undefined,
  identities: {
    homeTeam: unknown;
    awayTeam: unknown;
    winner: unknown;
  }
): (T & typeof identities) | null =>
  match ? { ...match, ...identities } : null;

export type KnockoutStageLike =
  | 'round_of_16'
  | 'quarter_finals'
  | 'semi_finals'
  | 'final'
  | 'third_place';

export type BracketNodeKindLike = 'championship' | 'third_place';
export type BracketSourceTypeLike = 'draw_pairing' | 'winner' | 'loser';

export interface BracketSourceLike {
  type: BracketSourceTypeLike;
  drawPairingSlot?: number;
  drawSide?: 'home' | 'away';
  sourceNodeKey?: string;
}

export interface KnockoutBracketNodePlan {
  key: string;
  stage: KnockoutStageLike;
  slot: number;
  kind: BracketNodeKindLike;
  homeSource: BracketSourceLike;
  awaySource: BracketSourceLike;
}

export interface KnockoutMatchResultLike {
  nodeKey: string;
  status: string;
  homeTeamId: string;
  awayTeamId: string;
  winnerTeamId?: string | null;
}

export interface KnockoutScoreResultLike {
  homeTeamId: string;
  awayTeamId: string;
  homeScore: number;
  awayScore: number;
  winnerTeamId?: string | null;
  shootoutScore?: { home?: number; away?: number };
}

export interface ResolvedKnockoutNode {
  nodeKey: string;
  winnerTeamId: string;
  loserTeamId: string;
}

export interface MaterializedKnockoutFixture {
  nodeKey: string;
  stage: KnockoutStageLike;
  slot: number;
  kind: BracketNodeKindLike;
  homeTeamId: string;
  awayTeamId: string;
}

export type KnockoutProgression =
  | {
      kind: 'materialize';
      nextStage: KnockoutStageLike;
      resolved: ResolvedKnockoutNode[];
      fixtures: MaterializedKnockoutFixture[];
    }
  | {
      kind: 'complete';
      championTeamId: string;
      runnerUpTeamId: string;
      resolved: ResolvedKnockoutNode[];
    };

export class KnockoutProgressionError extends Error {
  constructor(
    message: string,
    public readonly code: string
  ) {
    super(message);
    this.name = 'KnockoutProgressionError';
  }
}

export const isValidKnockoutScoreWinner = (result: KnockoutScoreResultLike): boolean => {
  if (!result.winnerTeamId) return false;
  const homeWon = result.winnerTeamId === result.homeTeamId;
  const awayWon = result.winnerTeamId === result.awayTeamId;
  if (!homeWon && !awayWon) return false;
  const shootoutHome = result.shootoutScore?.home;
  const shootoutAway = result.shootoutScore?.away;
  const hasShootout = Number.isInteger(shootoutHome) && Number.isInteger(shootoutAway);
  if (result.homeScore === result.awayScore) {
    return Boolean(
      hasShootout &&
        shootoutHome !== shootoutAway &&
        ((shootoutHome! > shootoutAway! && homeWon) ||
          (shootoutAway! > shootoutHome! && awayWon))
    );
  }
  return Boolean(
    !hasShootout &&
      ((result.homeScore > result.awayScore && homeWon) ||
        (result.awayScore > result.homeScore && awayWon))
  );
};

const CHAMPIONSHIP_STAGE_ORDER: Exclude<KnockoutStageLike, 'third_place'>[] = [
  'round_of_16',
  'quarter_finals',
  'semi_finals',
  'final',
];

export const bracketNodeKey = (stage: KnockoutStageLike, slot: number): string =>
  `${stage}:${slot}`;

/**
 * Builds the complete immutable winner-of/loser-of topology up front. Only
 * participant and match references are filled later; slot relationships never
 * depend on match dates or database insertion order.
 */
export const buildKnockoutBracketPlan = (
  entrantCount: number,
  includeThirdPlace: boolean
): KnockoutBracketNodePlan[] => {
  const firstStage = getFirstKnockoutStage(entrantCount);
  if (!firstStage || !isPowerOfTwo(entrantCount)) {
    throw new KnockoutProgressionError(
      'A durable bracket requires 2, 4, 8, or 16 entrants.',
      'UNSUPPORTED_BRACKET_SIZE'
    );
  }

  const firstStageIndex = CHAMPIONSHIP_STAGE_ORDER.indexOf(firstStage);
  const nodes: KnockoutBracketNodePlan[] = [];
  let matchesInStage = entrantCount / 2;

  for (let stageIndex = firstStageIndex; stageIndex < CHAMPIONSHIP_STAGE_ORDER.length; stageIndex++) {
    const stage = CHAMPIONSHIP_STAGE_ORDER[stageIndex];
    for (let slot = 1; slot <= matchesInStage; slot++) {
      const firstRound = stageIndex === firstStageIndex;
      const priorStage = CHAMPIONSHIP_STAGE_ORDER[stageIndex - 1];
      nodes.push({
        key: bracketNodeKey(stage, slot),
        stage,
        slot,
        kind: 'championship',
        homeSource: firstRound
          ? { type: 'draw_pairing', drawPairingSlot: slot, drawSide: 'home' }
          : { type: 'winner', sourceNodeKey: bracketNodeKey(priorStage, slot * 2 - 1) },
        awaySource: firstRound
          ? { type: 'draw_pairing', drawPairingSlot: slot, drawSide: 'away' }
          : { type: 'winner', sourceNodeKey: bracketNodeKey(priorStage, slot * 2) },
      });
    }
    matchesInStage /= 2;
  }

  if (includeThirdPlace && entrantCount >= 4) {
    nodes.push({
      key: bracketNodeKey('third_place', 1),
      stage: 'third_place',
      slot: 1,
      kind: 'third_place',
      homeSource: { type: 'loser', sourceNodeKey: bracketNodeKey('semi_finals', 1) },
      awaySource: { type: 'loser', sourceNodeKey: bracketNodeKey('semi_finals', 2) },
    });
  }

  if (new Set(nodes.map((node) => node.key)).size !== nodes.length) {
    throw new KnockoutProgressionError(
      'Bracket node keys must be unique.',
      'DUPLICATE_BRACKET_NODE_KEY'
    );
  }
  return nodes;
};

export const validateResolvedKnockoutRound = (
  expectedNodes: Array<Pick<KnockoutBracketNodePlan, 'key'>>,
  results: KnockoutMatchResultLike[]
): ResolvedKnockoutNode[] => {
  const expectedKeys = new Set(expectedNodes.map((node) => node.key));
  const resultKeys = new Set(results.map((result) => result.nodeKey));
  if (
    results.length !== expectedNodes.length ||
    resultKeys.size !== results.length ||
    [...resultKeys].some((key) => !expectedKeys.has(key))
  ) {
    throw new KnockoutProgressionError(
      'The current bracket round does not contain exactly one match per durable slot.',
      'KNOCKOUT_ROUND_MISMATCH'
    );
  }

  return expectedNodes.map((node) => {
    const result = results.find((item) => item.nodeKey === node.key)!;
    if (result.status !== 'completed') {
      throw new KnockoutProgressionError(
        'Every current-round match must be completed before progression.',
        'KNOCKOUT_ROUND_INCOMPLETE'
      );
    }
    if (
      !result.winnerTeamId ||
      (result.winnerTeamId !== result.homeTeamId && result.winnerTeamId !== result.awayTeamId)
    ) {
      throw new KnockoutProgressionError(
        'Every completed knockout match must have a validated participating winner.',
        'INVALID_KNOCKOUT_WINNER'
      );
    }
    return {
      nodeKey: node.key,
      winnerTeamId: result.winnerTeamId,
      loserTeamId:
        result.winnerTeamId === result.homeTeamId ? result.awayTeamId : result.homeTeamId,
    };
  });
};

export const deriveKnockoutProgression = (
  nodes: KnockoutBracketNodePlan[],
  currentStage: Exclude<KnockoutStageLike, 'third_place'>,
  results: KnockoutMatchResultLike[],
  materializedNodeKeys: Iterable<string> = []
): KnockoutProgression => {
  const currentNodes = nodes
    .filter((node) => node.kind === 'championship' && node.stage === currentStage)
    .sort((left, right) => left.slot - right.slot);
  if (currentNodes.length === 0) {
    throw new KnockoutProgressionError(
      'The requested current stage does not exist in this bracket.',
      'BRACKET_STAGE_NOT_FOUND'
    );
  }
  const resolved = validateResolvedKnockoutRound(currentNodes, results);
  if (currentStage === 'final') {
    return {
      kind: 'complete',
      championTeamId: resolved[0].winnerTeamId,
      runnerUpTeamId: resolved[0].loserTeamId,
      resolved,
    };
  }

  const nextStage = CHAMPIONSHIP_STAGE_ORDER[CHAMPIONSHIP_STAGE_ORDER.indexOf(currentStage) + 1];
  const targetNodes = nodes
    .filter(
      (node) => node.stage === nextStage || (currentStage === 'semi_finals' && node.kind === 'third_place')
    )
    .sort((left, right) => {
      if (left.kind !== right.kind) return left.kind === 'championship' ? -1 : 1;
      return left.slot - right.slot;
    });
  const materialized = new Set(materializedNodeKeys);
  if (targetNodes.some((node) => materialized.has(node.key))) {
    throw new KnockoutProgressionError(
      'The next bracket round has already been materialized.',
      'NEXT_ROUND_ALREADY_MATERIALIZED'
    );
  }

  const resolvedByKey = new Map(resolved.map((result) => [result.nodeKey, result]));
  const teamFromSource = (source: BracketSourceLike): string => {
    if (!source.sourceNodeKey || source.type === 'draw_pairing') {
      throw new KnockoutProgressionError(
        'A downstream bracket slot has an invalid source.',
        'INVALID_BRACKET_SOURCE'
      );
    }
    const sourceResult = resolvedByKey.get(source.sourceNodeKey);
    if (!sourceResult) {
      throw new KnockoutProgressionError(
        'A downstream bracket slot references an unresolved source.',
        'UNRESOLVED_BRACKET_SOURCE'
      );
    }
    return source.type === 'winner' ? sourceResult.winnerTeamId : sourceResult.loserTeamId;
  };

  return {
    kind: 'materialize',
    nextStage,
    resolved,
    fixtures: targetNodes.map((node) => ({
      nodeKey: node.key,
      stage: node.stage,
      slot: node.slot,
      kind: node.kind,
      homeTeamId: teamFromSource(node.homeSource),
      awayTeamId: teamFromSource(node.awaySource),
    })),
  };
};

export const getMissingCompetitionDecisions = (rules?: CompetitionRulesLike): string[] => {
  if (!rules) {
    return [
      'roundRobinLegs',
      'qualifiersPerGroup',
      'tieBreakers',
      'drawMode',
      'avoidSameGroupFirstRound',
      'thirdPlaceMatch',
      'maxRosterPlayers',
    ];
  }

  const missing: string[] = [];
  if (rules.roundRobinLegs !== 1 && rules.roundRobinLegs !== 2) missing.push('roundRobinLegs');
  if (!Number.isInteger(rules.qualifiersPerGroup) || (rules.qualifiersPerGroup ?? 0) < 1) {
    missing.push('qualifiersPerGroup');
  }
  if (!rules.tieBreakers || rules.tieBreakers.length === 0) missing.push('tieBreakers');
  if (!rules.drawMode) missing.push('drawMode');
  if (typeof rules.avoidSameGroupFirstRound !== 'boolean') {
    missing.push('avoidSameGroupFirstRound');
  }
  if (typeof rules.thirdPlaceMatch !== 'boolean') missing.push('thirdPlaceMatch');
  if (!Number.isInteger(rules.maxRosterPlayers) || (rules.maxRosterPlayers ?? 0) < 1) {
    missing.push('maxRosterPlayers');
  }
  return missing;
};

export const isPowerOfTwo = (value: number): boolean =>
  Number.isInteger(value) && value > 0 && (value & (value - 1)) === 0;

export const isCompetitionCompletionSatisfied = (
  thirdPlaceRequired: boolean,
  thirdPlaceResolved: boolean
): boolean => !thirdPlaceRequired || thirdPlaceResolved;

export const compareStandings = (
  left: ComparableStanding,
  right: ComparableStanding,
  tieBreakers: SupportedTieBreaker[]
): number => {
  for (const tieBreaker of tieBreakers) {
    let difference = 0;
    if (tieBreaker === 'points') difference = right.points - left.points;
    if (tieBreaker === 'goal_difference') {
      difference = right.goalDifference - left.goalDifference;
    }
    if (tieBreaker === 'goals_for') difference = right.goalsFor - left.goalsFor;
    if (difference !== 0) return difference;
  }
  return 0;
};

export const rankStandings = <T extends ComparableStanding>(
  rows: T[],
  tieBreakers: SupportedTieBreaker[]
): Array<T & RankedStanding> => {
  const sorted = [...rows].sort((left, right) => {
    return compareStandings(left, right, tieBreakers);
  });

  return sorted.map((row, index) => {
    const prior = sorted[index - 1];
    const rank =
      index === 0 || compareStandings(prior, row, tieBreakers) !== 0
        ? index + 1
        : (sorted[index - 1] as T & Partial<RankedStanding>).rank ?? index;
    const ranked = { ...row, rank } as T & RankedStanding;
    sorted[index] = ranked;
    return ranked;
  });
};

const PRIMARY_COMPETITION_TIE_BREAKERS: SupportedTieBreaker[] = [
  'points',
  'goal_difference',
  'goals_for',
];

const sameIdSet = (left: string[], right: string[]): boolean => {
  if (left.length !== right.length || new Set(left).size !== left.length) return false;
  const rightSet = new Set(right);
  return rightSet.size === right.length && left.every((value) => rightSet.has(value));
};

const buildHeadToHeadTable = (
  teamIds: string[],
  matches: HeadToHeadMatchLike[]
): HeadToHeadStanding[] => {
  const teamIdSet = new Set(teamIds);
  const table = new Map<string, HeadToHeadStanding>(
    teamIds.map((teamId) => [
      teamId,
      {
        teamId,
        played: 0,
        points: 0,
        goalDifference: 0,
        goalsFor: 0,
        goalsAgainst: 0,
      },
    ])
  );

  for (const match of matches) {
    if (!teamIdSet.has(match.homeTeamId) || !teamIdSet.has(match.awayTeamId)) continue;
    const home = table.get(match.homeTeamId)!;
    const away = table.get(match.awayTeamId)!;
    home.played++;
    away.played++;
    home.goalsFor += match.homeScore;
    home.goalsAgainst += match.awayScore;
    away.goalsFor += match.awayScore;
    away.goalsAgainst += match.homeScore;
    if (match.homeScore > match.awayScore) {
      home.points += 3;
    } else if (match.awayScore > match.homeScore) {
      away.points += 3;
    } else {
      home.points++;
      away.points++;
    }
    home.goalDifference = home.goalsFor - home.goalsAgainst;
    away.goalDifference = away.goalsFor - away.goalsAgainst;
  }
  return [...table.values()];
};

const createTieBasisHash = <T extends ComparableStanding>(
  groupKey: 'A' | 'B',
  tiedItems: Array<{ row: T; teamId: string }>,
  primaryClusterTeamIds: string[],
  headToHead: HeadToHeadStanding[],
  matches: HeadToHeadMatchLike[]
): string => {
  const primaryTeamIdSet = new Set(primaryClusterTeamIds);
  const canonicalMatches = matches
    .filter(
      (match) =>
        primaryTeamIdSet.has(match.homeTeamId) && primaryTeamIdSet.has(match.awayTeamId)
    )
    .map((match) => ({
      fixtureKey: match.fixtureKey ?? '',
      homeTeamId: match.homeTeamId,
      awayTeamId: match.awayTeamId,
      homeScore: match.homeScore,
      awayScore: match.awayScore,
    }))
    .sort((left, right) =>
      `${left.fixtureKey}:${left.homeTeamId}:${left.awayTeamId}`.localeCompare(
        `${right.fixtureKey}:${right.homeTeamId}:${right.awayTeamId}`
      )
    );
  const canonical = {
    version: 1,
    groupKey,
    primaryClusterTeamIds: [...primaryClusterTeamIds].sort(),
    tiedRows: tiedItems
      .map(({ row, teamId }) => ({
        teamId,
        points: row.points,
        goalDifference: row.goalDifference,
        goalsFor: row.goalsFor,
      }))
      .sort((left, right) => left.teamId.localeCompare(right.teamId)),
    headToHead: headToHead
      .filter((row) => tiedItems.some((item) => item.teamId === row.teamId))
      .sort((left, right) => left.teamId.localeCompare(right.teamId)),
    matches: canonicalMatches,
  };
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
};

/**
 * Applies the confirmed v2 ordering without using an ID or group-slot fallback.
 * A two-team primary tie is separated only by the completed direct match result.
 * A drawn direct match and every tie of three or more teams remain visibly tied
 * until a valid, basis-hashed committee ordering is supplied.
 */
export const rankFixedCompetitionGroup = <T extends ComparableStanding>(
  rows: T[],
  options: {
    groupKey: 'A' | 'B';
    teamIdOf: (row: T) => string;
    matches: HeadToHeadMatchLike[];
    resolutions?: CommitteeResolutionLike[];
    qualifiersPerGroup?: number;
  }
): FixedCompetitionRanking<T> => {
  const teamIds = rows.map(options.teamIdOf);
  if (new Set(teamIds).size !== teamIds.length) {
    throw new Error('Competition standings cannot contain a team more than once.');
  }

  const primarySorted = rows
    .map((row) => ({ row, teamId: options.teamIdOf(row) }))
    .sort((left, right) =>
      compareStandings(left.row, right.row, PRIMARY_COMPETITION_TIE_BREAKERS)
    );
  const primaryClusters: Array<typeof primarySorted> = [];
  for (const item of primarySorted) {
    const cluster = primaryClusters.at(-1);
    if (
      !cluster ||
      compareStandings(cluster[0].row, item.row, PRIMARY_COMPETITION_TIE_BREAKERS) !== 0
    ) {
      primaryClusters.push([item]);
    } else {
      cluster.push(item);
    }
  }

  const ranked: Array<T & RankedStanding> = [];
  const ties: CompetitionTieCluster[] = [];
  let nextPosition = 1;
  for (const primaryCluster of primaryClusters) {
    if (primaryCluster.length === 1) {
      ranked.push({ ...primaryCluster[0].row, rank: nextPosition });
      nextPosition++;
      continue;
    }

    const primaryClusterIds = primaryCluster.map((item) => item.teamId);
    const headToHead = buildHeadToHeadTable(primaryClusterIds, options.matches);
    const headToHeadByTeam = new Map(headToHead.map((row) => [row.teamId, row]));
    let headToHeadClusters: Array<typeof primaryCluster> = [primaryCluster];
    if (primaryCluster.length === 2) {
      const [left, right] = primaryCluster;
      const directMatches = options.matches.filter(
        (match) =>
          (match.homeTeamId === left.teamId && match.awayTeamId === right.teamId) ||
          (match.homeTeamId === right.teamId && match.awayTeamId === left.teamId)
      );
      if (directMatches.length === 1 && directMatches[0].homeScore !== directMatches[0].awayScore) {
        const winnerTeamId =
          directMatches[0].homeScore > directMatches[0].awayScore
            ? directMatches[0].homeTeamId
            : directMatches[0].awayTeamId;
        headToHeadClusters =
          left.teamId === winnerTeamId ? [[left], [right]] : [[right], [left]];
      }
    }

    for (const tiedItems of headToHeadClusters) {
      if (tiedItems.length === 1) {
        ranked.push({ ...tiedItems[0].row, rank: nextPosition });
        nextPosition++;
        continue;
      }

      const tiedTeamIds = tiedItems.map((item) => item.teamId);
      const basisHash = createTieBasisHash(
        options.groupKey,
        tiedItems,
        primaryClusterIds,
        headToHead,
        options.matches
      );
      const resolution = options.resolutions?.find(
        (candidate) =>
          candidate.groupKey === options.groupKey &&
          candidate.basisHash === basisHash &&
          sameIdSet(candidate.tiedTeamIds, tiedTeamIds) &&
          sameIdSet(candidate.orderedTeamIds, tiedTeamIds)
      );
      const startRank = nextPosition;
      const endRank = nextPosition + tiedItems.length - 1;
      const affectsQualificationOrSeeding =
        startRank <= (options.qualifiersPerGroup ?? 4);

      if (resolution) {
        const itemByTeamId = new Map(tiedItems.map((item) => [item.teamId, item]));
        for (const teamId of resolution.orderedTeamIds) {
          ranked.push({ ...itemByTeamId.get(teamId)!.row, rank: nextPosition });
          nextPosition++;
        }
      } else {
        for (const item of tiedItems) {
          ranked.push({ ...item.row, rank: startRank });
          nextPosition++;
        }
      }

      ties.push({
        groupKey: options.groupKey,
        basisHash,
        startRank,
        endRank,
        teamIds: tiedTeamIds,
        affectsQualificationOrSeeding,
        headToHead: tiedTeamIds.map((teamId) => headToHeadByTeam.get(teamId)!),
        resolved: Boolean(resolution),
        orderedTeamIds: resolution?.orderedTeamIds,
        method: resolution?.method,
        note: resolution?.note,
        decidedAt: resolution?.decidedAt,
      });
    }
  }

  return {
    rows: ranked,
    ties,
    unresolvedTies: ties.filter((tie) => !tie.resolved),
  };
};

export const hasUnresolvedQualificationTie = <T extends ComparableStanding>(
  rankedRows: T[],
  qualifiersPerGroup: number,
  tieBreakers: SupportedTieBreaker[]
): boolean => {
  if (qualifiersPerGroup < 1 || qualifiersPerGroup >= rankedRows.length) return false;
  return (
    compareStandings(
      rankedRows[qualifiersPerGroup - 1],
      rankedRows[qualifiersPerGroup],
      tieBreakers
    ) === 0
  );
};

export const getFirstKnockoutStage = (
  qualifierCount: number
): 'round_of_16' | 'quarter_finals' | 'semi_finals' | 'final' | null => {
  if (qualifierCount === 16) return 'round_of_16';
  if (qualifierCount === 8) return 'quarter_finals';
  if (qualifierCount === 4) return 'semi_finals';
  if (qualifierCount === 2) return 'final';
  return null;
};
