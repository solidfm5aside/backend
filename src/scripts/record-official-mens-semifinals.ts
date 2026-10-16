/** One-off historical result import. Read-only unless --execute is supplied. */
import dotenv from 'dotenv';
import mongoose, { Types } from 'mongoose';
import { createHash } from 'crypto';
import Match, { MatchFixtureSource, MatchScheduleStatus, MatchStage, MatchStatus } from '@/models/match.model';
import Tournament, { TournamentFormat, CompetitionWorkflowState } from '@/models/tournament.model';
import CompetitionBracket, { CompetitionBracketStatus } from '@/models/competition-bracket.model';
import { CompetitionDivision } from '@/models/competition-division';
import { KnockoutBracketNodePlan } from '@/utils/competition.util';
import { MENS_2026_ID, planOfficialMensSemis } from '@/utils/official-mens-semifinal-results';

dotenv.config();
async function main() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required');
  await mongoose.connect(process.env.MONGODB_URI);
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const tournament = await Tournament.findById(MENS_2026_ID).session(session);
      if (!tournament || tournament.isDeleted || tournament.division !== CompetitionDivision.MEN || tournament.season !== '2026' ||
        tournament.formatVersion !== 2 || tournament.format !== TournamentFormat.TWO_GROUP_KNOCKOUT ||
        tournament.workflowState !== CompetitionWorkflowState.KNOCKOUT_STAGE ||
        ![MatchStage.QUARTER_FINALS, MatchStage.SEMI_FINALS, MatchStage.FINAL].includes(tournament.currentStage)) {
        throw new Error('Refusing to modify a different competition or workflow');
      }
      const bracket = await CompetitionBracket.findOne({ tournamentId: tournament._id }).session(session);
      if (!bracket || bracket.status !== CompetitionBracketStatus.ACTIVE || bracket.entrantCount !== 8 || bracket.championTeamId) throw new Error('An active, undecided bracket is required');
      const matches = await Match.find({ tournamentId: tournament._id, bracketId: bracket._id, isDeleted: false }).session(session);
      const quarters = matches.filter(m => m.stage === MatchStage.QUARTER_FINALS);
      const nodes = bracket.nodes.map(n => ({ key: n.key, stage: n.stage, slot: n.slot, kind: n.kind,
        homeSource: n.homeSource, awaySource: n.awaySource })) as KnockoutBracketNodePlan[];
      const plan = planOfficialMensSemis(nodes, quarters.map(m => ({ nodeKey: m.bracketNodeKey!, status: m.status,
        homeTeamId: m.homeTeam.toString(), awayTeamId: m.awayTeam.toString(), homeScore: m.homeScore,
        awayScore: m.awayScore, winnerTeamId: m.winner?.toString(), shootoutScore: m.shootoutScore })));
      for (const q of quarters) {
        if (bracket.nodes.find(n => n.key === q.bracketNodeKey)?.matchId?.toString() !== q.id) throw new Error('Quarter-final reference mismatch');
      }
      let changed = false;
      const targets = [...plan.results.map(r => ({ ...r, stage: MatchStage.SEMI_FINALS, completed: true })),
        { ...plan.final, stage: MatchStage.FINAL, completed: false, homeScore: 0, awayScore: 0, winnerTeamId: undefined }];
      const now = new Date();
      for (const target of targets) {
        const node = bracket.nodes.find(n => n.key === target.nodeKey)!;
        const candidates = matches.filter(m => m.bracketNodeKey === target.nodeKey);
        if (candidates.length > 1) throw new Error('Duplicate bracket match');
        let match = candidates[0];
        if (match && (match.homeTeam.toString() !== target.homeTeamId || match.awayTeam.toString() !== target.awayTeamId ||
          node.matchId?.toString() !== match.id || match.stage !== target.stage)) throw new Error('Existing match conflicts with official bracket');
        if (!match && node.matchId) throw new Error('Dangling bracket match reference');
        if (match && !target.completed && (match.status !== MatchStatus.SCHEDULED || match.homeScore || match.awayScore || match.events.length || match.winner)) throw new Error('Final has already started; refusing repair');
        if (match && target.completed && match.status === MatchStatus.COMPLETED) {
          if (match.homeScore !== target.homeScore || match.awayScore !== target.awayScore || match.winner?.toString() !== target.winnerTeamId) throw new Error('Existing completed result differs; refusing overwrite');
          continue;
        }
        if (match && target.completed && (match.resultLockedAt || match.status !== MatchStatus.SCHEDULED || match.events.length || match.homeScore || match.awayScore)) throw new Error('Existing semi-final contains recorded activity; refusing overwrite');
        if (match && !target.completed) continue;
        changed = true;
        if (!process.argv.includes('--execute')) continue;
        if (!match) {
          match = new Match({ tournamentId: tournament._id, bracketId: bracket._id, bracketNodeKey: target.nodeKey,
            bracketSlot: target.slot, stage: target.stage, round: 1, homeTeam: target.homeTeamId, awayTeam: target.awayTeamId,
            fixtureKey: `${MENS_2026_ID}:knockout:${target.stage}:M${target.slot}`,
            officialFixtureNumber: target.completed ? 46 + target.slot : 49,
            fixtureSource: MatchFixtureSource.PHYSICAL_OFFICIAL, fixturePublishedAt: now,
            fixturePublicationHash: createHash('sha256').update(JSON.stringify(target)).digest('hex'),
            scheduleStatus: MatchScheduleStatus.PENDING, events: [] });
        }
        match.status = target.completed ? MatchStatus.COMPLETED : MatchStatus.SCHEDULED;
        match.homeScore = target.homeScore;
        match.awayScore = target.awayScore;
        if (target.winnerTeamId) match.winner = new Types.ObjectId(target.winnerTeamId);
        match.fixtureSourceReference = 'Official results confirmed by tournament owner, 2026-10-16; historical schedule not supplied';
        await match.save({ session });
        node.matchId = match._id as Types.ObjectId;
        node.homeTeamId = match.homeTeam;
        node.awayTeamId = match.awayTeam;
      }
      console.log(JSON.stringify({ execute: process.argv.includes('--execute'), changed, results: plan.results, final: plan.final }, null, 2));
      if (!process.argv.includes('--execute') || !changed) return;
      for (const resolved of plan.resolved) {
        const node = bracket.nodes.find(n => n.key === resolved.nodeKey)!;
        node.winnerTeamId = new Types.ObjectId(resolved.winnerTeamId);
        node.loserTeamId = new Types.ObjectId(resolved.loserTeamId);
        node.resolvedAt ??= now;
      }
      // Existing quarter-final records are never rewritten, including their events and scores.
      await Match.updateMany({ tournamentId: tournament._id, bracketId: bracket._id, stage: MatchStage.SEMI_FINALS,
        status: MatchStatus.COMPLETED }, { $set: { resultLockedAt: now, resultLockReason: 'advanced_to_final' } }, { session });
      tournament.currentStage = MatchStage.FINAL;
      tournament.workflowRevision += 1;
      bracket.revision = tournament.workflowRevision;
      await bracket.save({ session });
      await tournament.save({ session });
    });
  } finally { await session.endSession(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => mongoose.disconnect());
