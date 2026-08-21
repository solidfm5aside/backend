import Admin, { AdminRole, IAdmin } from '@/models/admin.model';
import {
  ADMIN_BOOTSTRAP_CLAIM,
  ADMIN_BOOTSTRAP_INDEX,
  bootstrapSecretsMatch,
  isBootstrapClaimConflict,
} from '@/utils/admin-bootstrap.util';

export interface AdminRegistrationInput {
  name: string;
  email: string;
  password: string;
}

export interface AdminRegistrationResult {
  admin: IAdmin;
  isFirstAdmin: boolean;
}

export class AdminRegistrationError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly code: string
  ) {
    super(message);
    this.name = 'AdminRegistrationError';
  }
}

const createPendingAdmin = (data: AdminRegistrationInput): Promise<IAdmin> =>
  Admin.create({
    ...data,
    role: AdminRole.VIEWER,
    isVerified: false,
  });

const ensureBootstrapClaimIndex = async (): Promise<void> => {
  await Admin.collection.createIndex(
    { bootstrapClaim: 1 },
    {
      unique: true,
      name: ADMIN_BOOTSTRAP_INDEX,
      partialFilterExpression: { bootstrapClaim: { $type: 'string' } },
    }
  );
};
/**
 * Existing installations keep their current registration behavior: once any
 * admin record exists, all new accounts are unverified viewers. An empty
 * database requires an explicitly configured secret. The unique bootstrap
 * claim is written on the same document as the first super admin, so two
 * concurrent requests cannot both win the bootstrap race.
 */
export const registerAdmin = async (
  data: AdminRegistrationInput,
  providedBootstrapSecret?: string
): Promise<AdminRegistrationResult> => {
  if (await Admin.exists({})) {
    return { admin: await createPendingAdmin(data), isFirstAdmin: false };
  }

  const configuredSecret = process.env.ADMIN_BOOTSTRAP_SECRET;
  if (!configuredSecret) {
    throw new AdminRegistrationError(
      'Initial admin bootstrap is not configured',
      503,
      'ADMIN_BOOTSTRAP_NOT_CONFIGURED'
    );
  }
  if (!bootstrapSecretsMatch(providedBootstrapSecret, configuredSecret)) {
    throw new AdminRegistrationError(
      'A valid bootstrap secret is required to create the initial administrator',
      403,
      'ADMIN_BOOTSTRAP_AUTH_REQUIRED'
    );
  }

  await ensureBootstrapClaimIndex();
  try {
    const admin = await Admin.create({
      ...data,
      role: AdminRole.SUPER_ADMIN,
      isVerified: true,
      bootstrapClaim: ADMIN_BOOTSTRAP_CLAIM,
    });
    return { admin, isFirstAdmin: true };
  } catch (error) {
    if (!isBootstrapClaimConflict(error)) throw error;

    // Another valid bootstrap request won the unique claim. It is now an
    // established installation, so this request follows normal pending review.
    if (!(await Admin.exists({}))) {
      throw new AdminRegistrationError(
        'Initial admin bootstrap could not be completed safely',
        503,
        'ADMIN_BOOTSTRAP_CONFLICT'
      );
    }
    return { admin: await createPendingAdmin(data), isFirstAdmin: false };
  }
};
