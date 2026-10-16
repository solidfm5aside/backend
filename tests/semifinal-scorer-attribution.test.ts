import { buildCompetitionPlayerStatsSnapshot } from '@/utils/competition.util';

it('credits one goal to each named semi-final scorer and keeps the existing own-goal bucket separate', () => {
  const rows = buildCompetitionPlayerStatsSnapshot([
    { status: 'completed', events: [{ type: 'goal', playerId: 'chimaobi', teamId: 'samba' }] },
    { status: 'completed', events: [
      { type: 'goal', playerId: 'lala-own-goal', teamId: 'lala' },
      { type: 'goal', playerId: 'godswill', teamId: 'lala' },
      { type: 'goal', playerId: 'chinedu', teamId: 'mrphil' },
    ] },
  ]);
  expect(rows.map(({ playerId, teamId, goals }) => ({ playerId, teamId, goals }))).toEqual([
    { playerId: 'chimaobi', teamId: 'samba', goals: 1 },
    { playerId: 'chinedu', teamId: 'mrphil', goals: 1 },
    { playerId: 'godswill', teamId: 'lala', goals: 1 },
    { playerId: 'lala-own-goal', teamId: 'lala', goals: 1 },
  ]);
});
