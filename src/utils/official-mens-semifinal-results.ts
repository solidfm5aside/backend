import { deriveKnockoutProgression, isValidKnockoutScoreWinner, KnockoutBracketNodePlan, KnockoutMatchResultLike } from './competition.util';

export const MENS_2026_ID = '6a88bfa4ce2cf64818770691';
export const OFFICIAL_SEMIS = [
  { homeTeamId: '6a88cb273d41d2698b001f0d', awayTeamId: '6a8981dcdf23052aa4afde11', homeScore: 1, awayScore: 0 },
  { homeTeamId: '6a88d5cf3d41d2698b001f1f', awayTeamId: '6a89817fdf23052aa4afde10', homeScore: 2, awayScore: 1 },
] as const;

export function planOfficialMensSemis(nodes: KnockoutBracketNodePlan[], quarters: (KnockoutMatchResultLike & { homeScore: number; awayScore: number; shootoutScore?: { home: number; away: number } })[]) {
  if (nodes.length !== 7 || nodes.some(n => n.kind !== 'championship')) throw new Error('Expected the seven-node men’s bracket without third place');
  if (quarters.length !== 4 || quarters.some(q => !isValidKnockoutScoreWinner(q))) throw new Error('Quarter-final scores and winners must be valid');
  const semis = deriveKnockoutProgression(nodes, 'quarter_finals', quarters);
  if (semis.kind !== 'materialize' || semis.fixtures.length !== 2) throw new Error('Expected two semi-finals');
  const results = semis.fixtures.map(fixture => {
    const official = OFFICIAL_SEMIS.find(result =>
      (result.homeTeamId === fixture.homeTeamId && result.awayTeamId === fixture.awayTeamId) ||
      (result.homeTeamId === fixture.awayTeamId && result.awayTeamId === fixture.homeTeamId));
    if (!official) throw new Error('The bracket participants do not match the official semi-finals');
    const sameOrientation = fixture.homeTeamId === official.homeTeamId;
    return { ...fixture, status: 'completed', homeScore: sameOrientation ? official.homeScore : official.awayScore,
      awayScore: sameOrientation ? official.awayScore : official.homeScore, winnerTeamId: official.homeTeamId };
  });
  const final = deriveKnockoutProgression(nodes, 'semi_finals', results);
  if (final.kind !== 'materialize' || final.fixtures.length !== 1) throw new Error('Expected one final');
  return { results, final: final.fixtures[0], resolved: [...semis.resolved, ...final.resolved] };
}
