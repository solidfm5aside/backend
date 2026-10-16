/** Backfill scorer attribution only. Match scores, winners, schedules and locks are unchanged. */
import 'dotenv/config';
import mongoose, { Types } from 'mongoose';
import { createHash } from 'crypto';
import Match, { MatchEventType, IMatchEvent } from '@/models/match.model';
import Tournament from '@/models/tournament.model';
import Player from '@/models/player.model';
import { recalculateTournamentStats } from '@/services/standings.service';
import { MENS_2026_ID, OFFICIAL_SEMIS } from '@/utils/official-mens-semifinal-results';

const assignments = [
  { node: 'semi_finals:1', ...OFFICIAL_SEMIS[0], scorers: [{ id: '6a88d33a3d41d2698b001f1a', name: 'Chimaobi Ekwueme', team: OFFICIAL_SEMIS[0].homeTeamId }] },
  { node: 'semi_finals:2', ...OFFICIAL_SEMIS[1], scorers: [
    { id: '6a88d7723d41d2698b001f26', name: 'Own Goal', team: OFFICIAL_SEMIS[1].homeTeamId },
    { id: '6a88d6b43d41d2698b001f20', name: 'Godswill', team: OFFICIAL_SEMIS[1].homeTeamId },
    { id: '6ad22800ee3f8847bf5e9820', name: 'Chinedu', team: OFFICIAL_SEMIS[1].awayTeamId },
  ] },
];
async function main() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI required');
  await mongoose.connect(process.env.MONGODB_URI);
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const tournament = await Tournament.findById(MENS_2026_ID).session(session);
      if (!tournament || tournament.isDeleted || tournament.division !== 'men' || tournament.season !== '2026' ||
        tournament.formatVersion !== 2 || tournament.format !== 'two_group_knockout' || tournament.currentStage !== 'final' ||
        tournament.workflowState !== 'knockout_stage') throw new Error('Unexpected tournament state');
      const plan = [];
      for (const assignment of assignments) {
        const matches = await Match.find({ tournamentId: MENS_2026_ID, bracketNodeKey: assignment.node, isDeleted: false })
          .select('+events.operationKey').session(session);
        const match = matches[0];
        if (matches.length !== 1 || match.stage !== 'semi_finals' || match.status !== 'completed' ||
          match.homeTeam.toString() !== assignment.homeTeamId || match.awayTeam.toString() !== assignment.awayTeamId ||
          match.homeScore !== assignment.homeScore || match.awayScore !== assignment.awayScore ||
          match.winner?.toString() !== assignment.homeTeamId || !match.resultLockedAt) throw new Error('Semi-final result no longer matches the official record');
        const events: (IMatchEvent & { operationKey: string })[] = [];
        for (const scorer of assignment.scorers) {
          const player = await Player.findById(scorer.id).session(session);
          if (!player || player.isDeleted || player.name.toLowerCase() !== scorer.name.toLowerCase() ||
            player.teamId.toString() !== scorer.team) throw new Error(`Registered player mismatch: ${scorer.name}`);
          const operationKey = createHash('sha256').update(`official-semi-scorer-20261016:${match.id}:${scorer.id}`).digest('hex');
          events.push({ _id: new Types.ObjectId(), type: MatchEventType.GOAL,
            // The existing console uses 0 for unreported minutes. Details explicitly distinguish this from a known kickoff goal.
            minute: 0, playerId: new Types.ObjectId(scorer.id), teamId: new Types.ObjectId(scorer.team), operationKey,
            details: 'Official scorer confirmed by tournament owner 2026-10-16. Goal minute not supplied; 0 is an unspecified-minute placeholder.' });
        }
        const knownKeys = new Set(events.map(e => e.operationKey));
        const existingGoals = match.events.filter(e => e.type === MatchEventType.GOAL);
        const alreadyApplied = existingGoals.length === events.length && existingGoals.every(e =>
          e.operationKey && knownKeys.has(e.operationKey) && events.some(n => n.operationKey === e.operationKey &&
            n.playerId.equals(e.playerId) && n.teamId.equals(e.teamId)));
        if (!alreadyApplied && existingGoals.length) throw new Error('Existing goal events need review; refusing duplicates');
        plan.push({ assignment, match, events, alreadyApplied });
      }
      console.log(JSON.stringify({ execute: process.argv.includes('--execute'), matches: plan.map(p => ({ node: p.assignment.node,
        scorers: p.assignment.scorers.map(s => s.name), alreadyApplied: p.alreadyApplied })) }));
      if (!process.argv.includes('--execute')) return;
      let changed = false;
      for (const item of plan) {
        if (item.alreadyApplied) continue;
        const result = await Match.updateOne({ _id: item.match._id, __v: item.match.__v,
          status: item.match.status, homeScore: item.match.homeScore, awayScore: item.match.awayScore },
          { $push: { events: { $each: item.events } }, $inc: { __v: 1 } }, { session, runValidators: true });
        if (result.modifiedCount !== 1) throw new Error('Match changed during attribution; transaction cancelled');
        changed = true;
      }
      if (changed) await recalculateTournamentStats(MENS_2026_ID, session);
    });
    console.log('Official scorer transaction completed');
  } finally { await session.endSession(); }
}
main().catch(e => { console.error(e.message); process.exitCode = 1; }).finally(() => mongoose.disconnect());
