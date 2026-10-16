import { buildKnockoutBracketPlan } from '@/utils/competition.util';
import { OFFICIAL_SEMIS, planOfficialMensSemis } from '@/utils/official-mens-semifinal-results';

const nodes = buildKnockoutBracketPlan(8, false);
const quarters = () => [OFFICIAL_SEMIS[0].homeTeamId, OFFICIAL_SEMIS[0].awayTeamId, OFFICIAL_SEMIS[1].homeTeamId, OFFICIAL_SEMIS[1].awayTeamId].map((winner, i) => ({
  nodeKey: `quarter_finals:${i + 1}`, homeTeamId: String(winner), awayTeamId: `opponent-${i}`, homeScore: 1, awayScore: 0,
  status: 'completed', winnerTeamId: String(winner),
}));
describe('official men’s historical semi-final repair plan', () => {
  it('records the two exact results and advances Samba and Lala only', () => {
    const input = quarters();
    const before = JSON.stringify({ nodes, input });
    const plan = planOfficialMensSemis(nodes, input);
    expect(plan.results).toEqual([
      expect.objectContaining({ homeTeamId: OFFICIAL_SEMIS[0].homeTeamId, awayTeamId: OFFICIAL_SEMIS[0].awayTeamId, homeScore: 1, awayScore: 0, status: 'completed' }),
      expect.objectContaining({ homeTeamId: OFFICIAL_SEMIS[1].homeTeamId, awayTeamId: OFFICIAL_SEMIS[1].awayTeamId, homeScore: 2, awayScore: 1, status: 'completed' }),
    ]);
    expect(plan.final).toEqual(expect.objectContaining({ homeTeamId: OFFICIAL_SEMIS[0].homeTeamId, awayTeamId: OFFICIAL_SEMIS[1].homeTeamId, stage: 'final' }));
    expect(plan.final).not.toHaveProperty('date');
    expect(JSON.stringify({ nodes, input })).toBe(before);
  });
  it('retains bracket orientation when home and away are reversed', () => {
    const input = quarters();
    [input[0].homeTeamId, input[1].homeTeamId] = [input[1].homeTeamId, input[0].homeTeamId];
    input[0].winnerTeamId = input[0].homeTeamId;
    input[1].winnerTeamId = input[1].homeTeamId;
    expect(planOfficialMensSemis(nodes, input).results[0]).toEqual(expect.objectContaining({ homeScore: 0, awayScore: 1, winnerTeamId: OFFICIAL_SEMIS[0].homeTeamId }));
  });
  it('rejects a women’s final topology', () => {
    expect(() => planOfficialMensSemis(buildKnockoutBracketPlan(2, false), quarters())).toThrow();
  });
  it('rejects unexpected participants instead of replacing existing results', () => {
    const input = quarters(); input[0].homeTeamId = 'unexpected'; input[0].winnerTeamId = 'unexpected';
    expect(() => planOfficialMensSemis(nodes, input)).toThrow('participants');
  });
  it('rejects incomplete quarter-finals', () => {
    const input = quarters(); input[0].status = 'scheduled';
    expect(() => planOfficialMensSemis(nodes, input)).toThrow();
  });
  it('rejects a stored winner that contradicts the score', () => {
    const input = quarters(); input[0].homeScore = 0; input[0].awayScore = 1;
    expect(() => planOfficialMensSemis(nodes, input)).toThrow('scores and winners');
  });
  it('rejects duplicate or missing slots and third place', () => {
    const input = quarters(); input[1].nodeKey = input[0].nodeKey;
    expect(() => planOfficialMensSemis(nodes, input)).toThrow();
    expect(() => planOfficialMensSemis(buildKnockoutBracketPlan(8, true), quarters())).toThrow();
  });
});
