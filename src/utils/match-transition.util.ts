export type MatchStatusValue = 'scheduled' | 'live' | 'completed' | 'cancelled';

/**
 * Pure status-transition policy. Callers are responsible for determining
 * whether a completed group/legacy result is still editable before setting
 * allowCompletedReopen.
 */
export const isMatchStatusTransitionAllowed = (
  current: MatchStatusValue,
  requested: MatchStatusValue,
  allowCompletedReopen = false
): boolean => {
  if (current === requested) return true;
  if (current === 'scheduled') {
    return requested === 'live' || requested === 'cancelled';
  }
  if (current === 'live') {
    return requested === 'completed' || requested === 'cancelled';
  }
  if (current === 'cancelled') return requested === 'scheduled';
  return current === 'completed' && requested === 'live' && allowCompletedReopen;
};

export const canReopenCompletedMatch = (
  isKnockoutStage: boolean,
  resultIsEditable: boolean
): boolean => !isKnockoutStage || resultIsEditable;
