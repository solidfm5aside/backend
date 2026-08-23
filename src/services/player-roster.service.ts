import mongoose, { ClientSession, QueryFilter } from 'mongoose';
import Player, { IPlayer } from '@/models/player.model';
import { ITeam } from '@/models/team.model';
import {
  CompetitionDivision,
  resolveCompetitionDivision,
} from '@/models/competition-division';
import { fenceTeamLifecycle } from '@/services/team-lifecycle.service';
import {
  enrollPlayerInUnstartedWomensCompetitions,
  WomensLateRosterError,
} from '@/services/womens-late-roster.service';
import { hasErrorCode } from '@/utils/http-error.util';

export const MAX_TEAM_ROSTER_SIZE = 10;
const MAX_SLOT_ALLOCATION_ATTEMPTS = 3;

export class PlayerRosterError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly code: string
  ) {
    super(message);
    this.name = 'PlayerRosterError';
  }
}

interface ActiveRosterPlayer {
  id: string;
  rosterSlot?: number | null;
}

const playerDocumentVersion = (player: IPlayer): number =>
  (player as IPlayer & { __v?: number }).__v ?? 0;

export interface RosterSlotPlan {
  activePlayerCount: number;
  assignments: Array<{ id: string; rosterSlot: number }>;
  availableSlot?: number;
}

const rosterFullError = () =>
  new PlayerRosterError(
    `A team cannot have more than ${MAX_TEAM_ROSTER_SIZE} active players`,
    409,
    'TEAM_ROSTER_FULL'
  );

export const planActiveRosterSlots = (players: ActiveRosterPlayer[]): RosterSlotPlan => {
  if (players.length > MAX_TEAM_ROSTER_SIZE) throw rosterFullError();

  const usedSlots = new Set<number>();
  for (const player of players) {
    if (player.rosterSlot === undefined || player.rosterSlot === null) continue;
    if (
      !Number.isInteger(player.rosterSlot) ||
      player.rosterSlot < 1 ||
      player.rosterSlot > MAX_TEAM_ROSTER_SIZE ||
      usedSlots.has(player.rosterSlot)
    ) {
      throw new PlayerRosterError(
        'The team roster contains conflicting legacy slot data',
        409,
        'TEAM_ROSTER_SLOT_CONFLICT'
      );
    }
    usedSlots.add(player.rosterSlot);
  }

  const assignments: Array<{ id: string; rosterSlot: number }> = [];
  for (const player of players) {
    if (player.rosterSlot !== undefined && player.rosterSlot !== null) continue;
    const rosterSlot = Array.from(
      { length: MAX_TEAM_ROSTER_SIZE },
      (_, index) => index + 1
    ).find((candidate) => !usedSlots.has(candidate));
    if (!rosterSlot) throw rosterFullError();
    usedSlots.add(rosterSlot);
    assignments.push({ id: player.id, rosterSlot });
  }

  return {
    activePlayerCount: players.length,
    assignments,
    availableSlot: Array.from(
      { length: MAX_TEAM_ROSTER_SIZE },
      (_, index) => index + 1
    ).find((candidate) => !usedSlots.has(candidate)),
  };
};

const normalizeActiveRosterSlots = async (
  teamId: string,
  session: ClientSession
): Promise<RosterSlotPlan> => {
  const activePlayers = await Player.find({ teamId, isDeleted: false })
    .select('+rosterSlot')
    .sort({ _id: 1 })
    .session(session);
  const plan = planActiveRosterSlots(
    activePlayers.map((player) => ({
      id: player._id.toString(),
      rosterSlot: player.rosterSlot ?? undefined,
    }))
  );

  for (const assignment of plan.assignments) {
    const result = await Player.updateOne(
      { _id: assignment.id, teamId, isDeleted: false },
      { $set: { rosterSlot: assignment.rosterSlot } },
      { session }
    );
    if (result.modifiedCount !== 1) {
      throw new PlayerRosterError(
        'The team roster changed during legacy slot migration. Refresh and retry.',
        409,
        'TEAM_ROSTER_STATE_CHANGED'
      );
    }
  }
  return plan;
};

const assertTeamAvailable = async (teamId: string, session: ClientSession): Promise<ITeam> => {
  const team = await fenceTeamLifecycle(teamId, session);
  if (!team) {
    throw new PlayerRosterError('Invalid or unavailable team ID', 400, 'INVALID_TEAM');
  }
  return team;
};

export const createPlayerInAvailableRosterSlot = async (
  playerData: Record<string, unknown>
): Promise<IPlayer> => {
  const teamId = String(playerData.teamId ?? '');
  if (!teamId) throw new PlayerRosterError('Invalid team ID', 400, 'INVALID_TEAM');

  for (let attempt = 1; attempt <= MAX_SLOT_ALLOCATION_ATTEMPTS; attempt += 1) {
    const session = await mongoose.startSession();
    let createdPlayer: IPlayer | undefined;
    let rosterIsFull = false;
    try {
      await session.withTransaction(async () => {
        createdPlayer = undefined;
        rosterIsFull = false;
        const team = await assertTeamAvailable(teamId, session);
        const plan = await normalizeActiveRosterSlots(teamId, session);
        if (plan.activePlayerCount >= MAX_TEAM_ROSTER_SIZE || !plan.availableSlot) {
          // Commit any safe legacy-slot migration, then report the cap without
          // inserting another dependent record.
          rosterIsFull = true;
          return;
        }
        createdPlayer = await new Player({
          ...playerData,
          teamId,
          rosterSlot: plan.availableSlot,
        }).save({ session });
        if (resolveCompetitionDivision(team.division) === CompetitionDivision.WOMEN) {
          const enrollment = await enrollPlayerInUnstartedWomensCompetitions(
            createdPlayer._id,
            teamId,
            playerDocumentVersion(createdPlayer),
            session
          );
          // A freshly-saved document includes select:false fields in its JSON
          // representation. Keep that internal value accurate if the admin
          // response serializes this instance instead of re-querying it.
          if (enrollment.enrolledTournamentIds.length > 0) {
            createdPlayer.competitionRosterRevision =
              (createdPlayer.competitionRosterRevision ?? 0) + 1;
          }
        }
      });
      if (rosterIsFull) throw rosterFullError();
      if (!createdPlayer) {
        throw new PlayerRosterError(
          'Player creation did not complete. Please retry.',
          409,
          'TEAM_ROSTER_STATE_CHANGED'
        );
      }
      return createdPlayer;
    } catch (error: unknown) {
      if (error instanceof WomensLateRosterError) {
        throw new PlayerRosterError(error.message, error.statusCode, error.code);
      }
      if (hasErrorCode(error, 11000) && attempt < MAX_SLOT_ALLOCATION_ATTEMPTS) continue;
      if (hasErrorCode(error, 11000)) throw rosterFullError();
      throw error;
    } finally {
      await session.endSession();
    }
  }

  throw rosterFullError();
};

interface TransferPlayerResult {
  player: IPlayer | null;
  rosterIsFull: boolean;
}

export const transferPlayerToAvailableRosterSlot = async (
  filter: QueryFilter<IPlayer>,
  updates: Record<string, unknown>
): Promise<TransferPlayerResult> => {
  const sourceTeamId = String(filter.teamId ?? '');
  const destinationTeamId = String(updates.teamId ?? '');
  if (!sourceTeamId || !destinationTeamId) {
    throw new PlayerRosterError('Invalid team transfer', 400, 'INVALID_TEAM');
  }

  for (let attempt = 1; attempt <= MAX_SLOT_ALLOCATION_ATTEMPTS; attempt += 1) {
    const session = await mongoose.startSession();
    let transferredPlayer: IPlayer | null = null;
    let destinationRosterIsFull = false;
    try {
      await session.withTransaction(async () => {
        transferredPlayer = null;
        destinationRosterIsFull = false;
        // A deterministic order avoids two opposite transfers deadlocking.
        const fencedTeams = new Map<string, ITeam>();
        for (const teamId of [...new Set([sourceTeamId, destinationTeamId])].sort()) {
          fencedTeams.set(teamId, await assertTeamAvailable(teamId, session));
        }
        const sourceDivision = resolveCompetitionDivision(
          fencedTeams.get(sourceTeamId)?.division
        );
        const destinationDivision = resolveCompetitionDivision(
          fencedTeams.get(destinationTeamId)?.division
        );
        if (sourceDivision !== destinationDivision) {
          throw new PlayerRosterError(
            'A player cannot be transferred between men’s and women’s teams.',
            409,
            'PLAYER_TEAM_DIVISION_MISMATCH'
          );
        }
        const plan = await normalizeActiveRosterSlots(destinationTeamId, session);
        if (plan.activePlayerCount >= MAX_TEAM_ROSTER_SIZE || !plan.availableSlot) {
          destinationRosterIsFull = true;
          return;
        }
        transferredPlayer = await Player.findOneAndUpdate(
          filter,
          {
            $set: { ...updates, teamId: destinationTeamId, rosterSlot: plan.availableSlot },
            $inc: { competitionRosterRevision: 1, __v: 1 },
          },
          { new: true, runValidators: true, session }
        );
        if (transferredPlayer && destinationDivision === CompetitionDivision.WOMEN) {
          await enrollPlayerInUnstartedWomensCompetitions(
            transferredPlayer._id,
            destinationTeamId,
            playerDocumentVersion(transferredPlayer),
            session
          );
        }
      });
      if (destinationRosterIsFull) return { player: null, rosterIsFull: true };
      return { player: transferredPlayer, rosterIsFull: false };
    } catch (error: unknown) {
      if (error instanceof WomensLateRosterError) {
        throw new PlayerRosterError(error.message, error.statusCode, error.code);
      }
      if (error instanceof PlayerRosterError && error.code === 'TEAM_ROSTER_FULL') {
        return { player: null, rosterIsFull: true };
      }
      if (hasErrorCode(error, 11000) && attempt < MAX_SLOT_ALLOCATION_ATTEMPTS) continue;
      if (hasErrorCode(error, 11000)) return { player: null, rosterIsFull: true };
      throw error;
    } finally {
      await session.endSession();
    }
  }

  return { player: null, rosterIsFull: true };
};
