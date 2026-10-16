/** Targeted official-poster metadata correction; never changes a result or event. */
import 'dotenv/config';
import mongoose from 'mongoose';
import Match, { MatchScheduleStatus } from '@/models/match.model';
import Tournament from '@/models/tournament.model';
import CompetitionBracket from '@/models/competition-bracket.model';
import Venue from '@/models/venue.model';
import { MENS_2026_ID, OFFICIAL_SEMIS } from '@/utils/official-mens-semifinal-results';

// Posters supplied by the tournament owner on 16 October. WAT is UTC+01:00.
const schedules = [
  { node: 'semi_finals:1', stage: 'semi_finals', ...OFFICIAL_SEMIS[0], status: 'completed', date: '2026-10-11T14:00:00.000Z', venue: 'Wembley Arena' },
  { node: 'semi_finals:2', stage: 'semi_finals', ...OFFICIAL_SEMIS[1], status: 'completed', date: '2026-10-11T14:00:00.000Z', venue: 'Tribu Arena' },
  { node: 'final:1', stage: 'final', homeTeamId: OFFICIAL_SEMIS[0].homeTeamId, awayTeamId: OFFICIAL_SEMIS[1].homeTeamId,
    homeScore: 0, awayScore: 0, status: 'scheduled', date: '2026-10-18T14:00:00.000Z', venue: 'Wembley Arena' },
];

async function main() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required');
  await mongoose.connect(process.env.MONGODB_URI);
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const tournament = await Tournament.findById(MENS_2026_ID).session(session);
      if (!tournament || tournament.isDeleted || tournament.division !== 'men' || tournament.season !== '2026' ||
        tournament.formatVersion !== 2 || tournament.format !== 'two_group_knockout' ||
        tournament.currentStage !== 'final' || tournament.workflowState !== 'knockout_stage') throw new Error('Unexpected tournament state');
      const bracket = await CompetitionBracket.findOne({ tournamentId: MENS_2026_ID }).session(session);
      if (!bracket || bracket.status !== 'active') throw new Error('Expected an active men’s bracket');
      const matches = await Match.find({ tournamentId: MENS_2026_ID, bracketId: bracket._id, isDeleted: false,
        bracketNodeKey: { $in: schedules.map(s => s.node) } }).session(session);
      if (matches.length !== 3) throw new Error('Expected exactly the two semi-finals and final');
      const planned = schedules.map(official => {
        const m = matches.find(m => m.bracketNodeKey === official.node);
        if (!m || m.stage !== official.stage || m.status !== official.status || m.homeTeam.toString() !== official.homeTeamId ||
          m.awayTeam.toString() !== official.awayTeamId || m.homeScore !== official.homeScore || m.awayScore !== official.awayScore ||
          bracket.nodes.find(n => n.key === official.node)?.matchId?.toString() !== m.id) throw new Error('Match no longer agrees with the official record');
        if (official.stage === 'semi_finals' && m.winner?.toString() !== official.homeTeamId) throw new Error('Semi-final winner changed');
        if (official.stage === 'final' && (m.events.length || m.winner || m.resultLockedAt)) throw new Error('The final already has activity');
        const alreadyCorrect = m.date?.toISOString() === official.date && m.venue === official.venue && m.scheduleStatus === MatchScheduleStatus.CONFIRMED;
        if (!alreadyCorrect && (m.date || m.venue || m.scheduleStatus !== MatchScheduleStatus.PENDING)) throw new Error('Refusing to overwrite a different official schedule');
        return { m, official, alreadyCorrect };
      });
      const tribu = await Venue.findOne({ name: 'Tribu Arena', isDeleted: false }).session(session);
      if (!tribu) throw new Error('Existing Tribu Arena venue is unavailable');
      const wembley = await Venue.findOne({ name: 'Wembley Arena' }).session(session);
      if (wembley?.isDeleted) throw new Error('Wembley Arena was deleted; refusing to reactivate');
      const report = planned.map(({ m, official, alreadyCorrect }) => ({ matchId: m.id, node: official.node,
        date: official.date, localTime: '3:00 PM Africa/Lagos', venue: official.venue, changed: !alreadyCorrect }));
      console.log(JSON.stringify({ execute: process.argv.includes('--execute'), createWembleyArena: !wembley, schedules: report }, null, 2));
      if (!process.argv.includes('--execute')) return;
      // Retain Wembley Hotel and every historical venue name. Register the poster's venue independently.
      if (!wembley) await Venue.create([{ name: 'Wembley Arena', address: 'Trans Ekulu, Enugu', importance: 1 }], { session });
      for (const { m, official, alreadyCorrect } of planned) {
        if (alreadyCorrect) continue;
        const result = await Match.updateOne({ _id: m._id, __v: m.__v, status: official.status, homeScore: official.homeScore,
          awayScore: official.awayScore, scheduleStatus: MatchScheduleStatus.PENDING, date: null, venue: null },
          { $set: { date: new Date(official.date), venue: official.venue, scheduleStatus: MatchScheduleStatus.CONFIRMED,
            fixtureSourceReference: 'Official men’s semi-final/final schedule posters supplied by tournament owner on 2026-10-16; times Africa/Lagos' }, $inc: { __v: 1 } },
          { session, runValidators: true });
        if (result.modifiedCount !== 1) throw new Error('Match changed during schedule correction; transaction cancelled');
      }
    });
    console.log('Official schedule transaction completed');
  } finally { await session.endSession(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => mongoose.disconnect());
