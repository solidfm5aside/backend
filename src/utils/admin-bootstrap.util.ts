import crypto from 'crypto';

export const ADMIN_BOOTSTRAP_HEADER = 'x-admin-bootstrap-secret';
export const ADMIN_BOOTSTRAP_CLAIM = 'initial_admin';
export const ADMIN_BOOTSTRAP_INDEX = 'one_initial_admin_bootstrap';

export const bootstrapSecretsMatch = (
  providedSecret: string | undefined,
  configuredSecret: string | undefined
): boolean => {
  if (!providedSecret || !configuredSecret) return false;

  const providedDigest = crypto.createHash('sha256').update(providedSecret).digest();
  const configuredDigest = crypto.createHash('sha256').update(configuredSecret).digest();
  return crypto.timingSafeEqual(providedDigest, configuredDigest);
};
export const isBootstrapClaimConflict = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false;

  const candidate = error as {
    code?: number;
    keyPattern?: Record<string, unknown>;
    keyValue?: Record<string, unknown>;
    message?: string;
  };
  if (candidate.code !== 11000) return false;

  return Boolean(
    candidate.keyPattern?.bootstrapClaim ||
      candidate.keyValue?.bootstrapClaim === ADMIN_BOOTSTRAP_CLAIM ||
      candidate.message?.includes(ADMIN_BOOTSTRAP_INDEX)
  );
};
