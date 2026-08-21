export interface CompetitionTeamIdentitySnapshot {
  tournamentId: unknown;
  teamId: unknown;
  teamNameSnapshot: string;
  teamLogoSnapshot?: string;
}

export interface CompetitionPlayerIdentitySnapshot {
  tournamentId: unknown;
  playerId: unknown;
  playerNameSnapshot: string;
}

type PlainRecord = Record<string, unknown>;

export const competitionReferenceId = (reference: unknown): string | undefined => {
  if (reference === null || reference === undefined) return undefined;
  if (typeof reference === 'object' && '_id' in reference) {
    return String((reference as { _id: unknown })._id);
  }
  return String(reference);
};

export const competitionIdentityKey = (tournamentId: unknown, teamId: unknown): string =>
  `${String(tournamentId)}:${String(teamId)}`;

export const competitionPlayerIdentityKey = (
  tournamentId: unknown,
  playerId: unknown
): string => `${String(tournamentId)}:${String(playerId)}`;

export const buildCompetitionIdentitySnapshotMap = (
  snapshots: CompetitionTeamIdentitySnapshot[]
): Map<string, CompetitionTeamIdentitySnapshot> =>
  new Map(
    snapshots.map((snapshot) => [
      competitionIdentityKey(snapshot.tournamentId, snapshot.teamId),
      snapshot,
    ])
  );

export const buildCompetitionPlayerIdentitySnapshotMap = (
  snapshots: CompetitionPlayerIdentitySnapshot[]
): Map<string, CompetitionPlayerIdentitySnapshot> =>
  new Map(
    snapshots.map((snapshot) => [
      competitionPlayerIdentityKey(snapshot.tournamentId, snapshot.playerId),
      snapshot,
    ])
  );

export const applyTeamIdentitySnapshot = (
  team: unknown,
  snapshot?: CompetitionTeamIdentitySnapshot
): unknown => {
  if (!snapshot || team === null || team === undefined) return team;
  const current =
    typeof team === 'object' && '_id' in team
      ? (team as PlainRecord)
      : ({ _id: team } satisfies PlainRecord);
  return {
    ...current,
    name: snapshot.teamNameSnapshot,
    logo: snapshot.teamLogoSnapshot ?? '',
  };
};

export const applyPlayerIdentitySnapshot = (
  player: unknown,
  snapshot?: CompetitionPlayerIdentitySnapshot
): unknown => {
  if (!snapshot || player === null || player === undefined) return player;
  const current =
    typeof player === 'object' && '_id' in player
      ? (player as PlainRecord)
      : ({ _id: player } satisfies PlainRecord);
  return {
    ...current,
    name: snapshot.playerNameSnapshot,
  };
};

export const applyCompletedCompetitionIdentitySnapshots = <T extends object>(
  matches: T[],
  completedTournamentIds: Set<string>,
  snapshots: Map<string, CompetitionTeamIdentitySnapshot>,
  playerSnapshots: Map<string, CompetitionPlayerIdentitySnapshot> = new Map()
): T[] =>
  matches.map((match) => {
    const plainMatch = match as unknown as PlainRecord;
    const tournamentId = competitionReferenceId(plainMatch.tournamentId);
    if (!tournamentId || !completedTournamentIds.has(tournamentId)) return match;

    const withSnapshot = (team: unknown) => {
      const teamId = competitionReferenceId(team);
      return teamId
        ? applyTeamIdentitySnapshot(
            team,
            snapshots.get(competitionIdentityKey(tournamentId, teamId))
          )
        : team;
    };
    const withPlayerSnapshot = (player: unknown) => {
      const playerId = competitionReferenceId(player);
      return playerId
        ? applyPlayerIdentitySnapshot(
            player,
            playerSnapshots.get(competitionPlayerIdentityKey(tournamentId, playerId))
          )
        : player;
    };
    const events = Array.isArray(plainMatch.events)
      ? plainMatch.events.map((event) => {
          if (!event || typeof event !== 'object') return event;
          const plainEvent = event as PlainRecord;
          return {
            ...plainEvent,
            playerId: withPlayerSnapshot(plainEvent.playerId),
            assistPlayerId: withPlayerSnapshot(plainEvent.assistPlayerId),
          };
        })
      : plainMatch.events;

    return {
      ...plainMatch,
      homeTeam: withSnapshot(plainMatch.homeTeam),
      awayTeam: withSnapshot(plainMatch.awayTeam),
      winner: withSnapshot(plainMatch.winner),
      ...(events === undefined ? {} : { events }),
    } as T;
  });

export const applyCompletedCompetitionScorerIdentitySnapshots = <T extends object>(
  scorers: T[],
  completedTournamentIds: Set<string>,
  teamSnapshots: Map<string, CompetitionTeamIdentitySnapshot>,
  playerSnapshots: Map<string, CompetitionPlayerIdentitySnapshot>
): T[] =>
  scorers.map((scorer) => {
    const plainScorer = scorer as unknown as PlainRecord;
    const tournamentId = competitionReferenceId(plainScorer.tournamentId);
    if (!tournamentId || !completedTournamentIds.has(tournamentId)) return scorer;
    const teamId = competitionReferenceId(plainScorer.teamId);
    const playerId = competitionReferenceId(plainScorer.playerId);
    return {
      ...plainScorer,
      teamId: teamId
        ? applyTeamIdentitySnapshot(
            plainScorer.teamId,
            teamSnapshots.get(competitionIdentityKey(tournamentId, teamId))
          )
        : plainScorer.teamId,
      playerId: playerId
        ? applyPlayerIdentitySnapshot(
            plainScorer.playerId,
            playerSnapshots.get(competitionPlayerIdentityKey(tournamentId, playerId))
          )
        : plainScorer.playerId,
    } as T;
  });
