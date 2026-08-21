export interface CompetitionEntryIdentity {
  name: string;
  logo?: string;
}

export const buildCompetitionEntryIdentityUpdate = (
  identity: CompetitionEntryIdentity
): {
  $set: { teamNameSnapshot: string; teamLogoSnapshot?: string };
  $unset?: { teamLogoSnapshot: 1 };
} => {
  const name = identity.name.trim();
  if (!name) throw new Error('A team snapshot name is required.');
  if (identity.logo) {
    return {
      $set: {
        teamNameSnapshot: name,
        teamLogoSnapshot: identity.logo,
      },
    };
  }
  return {
    $set: { teamNameSnapshot: name },
    $unset: { teamLogoSnapshot: 1 },
  };
};
