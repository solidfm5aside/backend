export type CommitteeResolutionAuditStatus = 'active' | 'superseded';

export interface CommitteeResolutionAuditLike {
  decisionId: string;
  decisionRevision: number;
  status?: CommitteeResolutionAuditStatus;
  groupKey: 'A' | 'B';
  basisHash: string;
  decidedAt: Date;
  supersededAt?: Date;
  supersededByDecisionId?: string;
}

export const appendCommitteeResolutionDecision = <
  T extends CommitteeResolutionAuditLike,
>(history: T[], decision: T, correctedAt: Date): T[] => {
  if (decision.status && decision.status !== 'active') {
    throw new Error('A new committee decision must be active.');
  }
  const next = history.map((existing) => {
    const sameBasis =
      existing.groupKey === decision.groupKey &&
      existing.basisHash === decision.basisHash;
    const active = !existing.status || existing.status === 'active';
    return sameBasis && active
      ? {
          ...existing,
          status: 'superseded' as const,
          supersededAt: correctedAt,
          supersededByDecisionId: decision.decisionId,
        }
      : existing;
  });
  return [...next, { ...decision, status: 'active' }];
};

export const selectActiveCommitteeResolutions = <
  T extends CommitteeResolutionAuditLike,
>(history: T[]): T[] => {
  const activeByBasis = new Map<string, T>();
  for (const decision of history) {
    if (decision.status === 'superseded') continue;
    const key = `${decision.groupKey}:${decision.basisHash}`;
    const current = activeByBasis.get(key);
    if (
      !current ||
      decision.decisionRevision > current.decisionRevision ||
      (decision.decisionRevision === current.decisionRevision &&
        decision.decidedAt.getTime() > current.decidedAt.getTime())
    ) {
      activeByBasis.set(key, decision);
    }
  }
  return [...activeByBasis.values()];
};
