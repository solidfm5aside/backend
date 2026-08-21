export interface TournamentEntryForRoster {
  id: string;
  teamId: string;
}

export interface PlayerForRoster {
  id: string;
  teamId: string;
  name: string;
  position: string;
  jerseyNumber: number;
  nationality: string;
  photo?: string;
}

export interface TournamentRosterSnapshotRow {
  tournamentId: string;
  tournamentEntryId: string;
  teamId: string;
  playerId: string;
  playerNameSnapshot: string;
  positionSnapshot: string;
  jerseyNumberSnapshot: number;
  nationalitySnapshot: string;
  photoSnapshot?: string;
  publicationRevision: number;
  capturedAt: Date;
}

export interface TournamentRosterLimitViolation {
  tournamentEntryId: string;
  teamId: string;
  playerCount: number;
  maxRosterPlayers: number;
}

export const findTournamentRosterLimitViolations = (
  entries: TournamentEntryForRoster[],
  players: Array<Pick<PlayerForRoster, 'teamId'>>,
  maxRosterPlayers: number
): TournamentRosterLimitViolation[] => {
  if (!Number.isInteger(maxRosterPlayers) || maxRosterPlayers < 1) {
    throw new Error('The maximum tournament roster size must be a positive integer.');
  }
  const playerCountByTeam = new Map<string, number>();
  for (const player of players) {
    playerCountByTeam.set(player.teamId, (playerCountByTeam.get(player.teamId) ?? 0) + 1);
  }
  return entries
    .map((entry) => ({
      tournamentEntryId: entry.id,
      teamId: entry.teamId,
      playerCount: playerCountByTeam.get(entry.teamId) ?? 0,
      maxRosterPlayers,
    }))
    .filter((entry) => entry.playerCount > maxRosterPlayers);
};

export const buildTournamentRosterSnapshotRows = (
  tournamentId: string,
  publicationRevision: number,
  entries: TournamentEntryForRoster[],
  players: PlayerForRoster[],
  capturedAt: Date
): TournamentRosterSnapshotRow[] => {
  const entryByTeam = new Map(entries.map((entry) => [entry.teamId, entry]));
  return players.map((player) => {
    const entry = entryByTeam.get(player.teamId);
    if (!entry) {
      throw new Error('Every rostered player must belong to a published tournament entry.');
    }
    return {
      tournamentId,
      tournamentEntryId: entry.id,
      teamId: player.teamId,
      playerId: player.id,
      playerNameSnapshot: player.name,
      positionSnapshot: player.position,
      jerseyNumberSnapshot: player.jerseyNumber,
      nationalitySnapshot: player.nationality,
      ...(player.photo ? { photoSnapshot: player.photo } : {}),
      publicationRevision,
      capturedAt,
    };
  });
};

export const isPlayerTeamTransfer = (
  currentTeamId: string,
  requestedTeamId?: string
): boolean => Boolean(requestedTeamId && requestedTeamId !== currentTeamId);
