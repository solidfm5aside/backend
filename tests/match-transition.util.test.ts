import {
  canReopenCompletedMatch,
  isMatchStatusTransitionAllowed,
} from '@/utils/match-transition.util';

describe('match status transition policy', () => {
  it('allows only the explicit forward, cancellation, and reschedule transitions', () => {
    expect(isMatchStatusTransitionAllowed('scheduled', 'live')).toBe(true);
    expect(isMatchStatusTransitionAllowed('scheduled', 'cancelled')).toBe(true);
    expect(isMatchStatusTransitionAllowed('live', 'completed')).toBe(true);
    expect(isMatchStatusTransitionAllowed('live', 'cancelled')).toBe(true);
    expect(isMatchStatusTransitionAllowed('cancelled', 'scheduled')).toBe(true);

    expect(isMatchStatusTransitionAllowed('scheduled', 'completed')).toBe(false);
    expect(isMatchStatusTransitionAllowed('cancelled', 'live')).toBe(false);
    expect(isMatchStatusTransitionAllowed('live', 'scheduled')).toBe(false);
  });

  it('is idempotent and gates completed-result reopening explicitly', () => {
    expect(isMatchStatusTransitionAllowed('completed', 'completed')).toBe(true);
    expect(isMatchStatusTransitionAllowed('completed', 'live')).toBe(false);
    expect(isMatchStatusTransitionAllowed('completed', 'live', true)).toBe(true);
    expect(isMatchStatusTransitionAllowed('completed', 'cancelled', true)).toBe(false);
  });

  it('allows a knockout correction only after the bracket editability guard passes', () => {
    expect(canReopenCompletedMatch(true, false)).toBe(false);
    expect(canReopenCompletedMatch(true, true)).toBe(true);
    expect(canReopenCompletedMatch(false, false)).toBe(true);
  });
});
