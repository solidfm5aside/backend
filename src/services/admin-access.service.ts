import mongoose, { ClientSession } from 'mongoose';
import Admin, { AdminRole, IAdmin } from '@/models/admin.model';
import AdminAccessControl from '@/models/admin-access-control.model';
import { hasErrorCode } from '@/utils/http-error.util';

const ACCESS_CONTROL_ID = 'admin-role-management';

export class AdminAccessError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly code: string
  ) {
    super(message);
    this.name = 'AdminAccessError';
  }
}

export interface AdminAccessSubject {
  id: string;
  isDeleted: boolean;
  isVerified: boolean;
  role: AdminRole;
}

export interface AdminRoleChangePlan {
  changed: boolean;
  isVerified: boolean;
  role: AdminRole;
}

interface PlanAdminRoleChangeInput {
  actor: AdminAccessSubject | null;
  nextRole: AdminRole;
  target: AdminAccessSubject | null;
  verifiedSuperAdminCount: number;
}

export const planAdminRoleChange = ({
  actor,
  nextRole,
  target,
  verifiedSuperAdminCount,
}: PlanAdminRoleChangeInput): AdminRoleChangePlan => {
  if (!actor || actor.isDeleted || !actor.isVerified || actor.role !== AdminRole.SUPER_ADMIN) {
    throw new AdminAccessError(
      'Only a verified Super Admin can change administrator roles',
      403,
      'ADMIN_ROLE_CHANGE_FORBIDDEN'
    );
  }
  if (!target || target.isDeleted) {
    throw new AdminAccessError('Administrator not found', 404, 'ADMIN_NOT_FOUND');
  }

  if (actor.id === target.id && nextRole !== target.role) {
    throw new AdminAccessError(
      'You cannot change your own Super Admin role',
      409,
      'ADMIN_SELF_DEMOTION_FORBIDDEN'
    );
  }

  if (
    target.role === AdminRole.SUPER_ADMIN &&
    nextRole !== AdminRole.SUPER_ADMIN &&
    verifiedSuperAdminCount <= 1
  ) {
    throw new AdminAccessError(
      'At least one verified Super Admin must remain',
      409,
      'LAST_SUPER_ADMIN_REQUIRED'
    );
  }

  const isVerified = nextRole === AdminRole.VIEWER ? target.isVerified : true;
  return {
    changed: target.role !== nextRole || target.isVerified !== isVerified,
    isVerified,
    role: nextRole,
  };
};

const ensureAccessControlFenceExists = async (): Promise<void> => {
  try {
    await AdminAccessControl.updateOne(
      { _id: ACCESS_CONTROL_ID },
      { $setOnInsert: { revision: 0 } },
      { upsert: true }
    );
  } catch (error: unknown) {
    // Two first-ever requests can race to create the singleton. The winner has
    // already created the fence, so the loser can safely continue.
    if (!hasErrorCode(error, 11000)) throw error;
  }
};

const fenceAdminAccessTransaction = async (session: ClientSession): Promise<void> => {
  const result = await AdminAccessControl.updateOne(
    { _id: ACCESS_CONTROL_ID },
    { $inc: { revision: 1 } },
    { session }
  );
  if (result.matchedCount !== 1) {
    throw new AdminAccessError(
      'Administrator access control is unavailable. Please retry.',
      409,
      'ADMIN_ACCESS_CHANGE_CONFLICT'
    );
  }
};

const toSubject = (admin: IAdmin): AdminAccessSubject => ({
  id: admin._id.toString(),
  isDeleted: admin.isDeleted,
  isVerified: admin.isVerified,
  role: admin.role,
});

export const changeAdminRole = async (
  actorId: string,
  targetId: string,
  nextRole: AdminRole
): Promise<IAdmin> => {
  await ensureAccessControlFenceExists();
  const session = await mongoose.startSession();
  let result: IAdmin | undefined;

  try {
    await session.withTransaction(async () => {
      result = undefined;
      // Every role mutation writes the same singleton inside its transaction.
      // MongoDB therefore turns concurrent last-super-admin demotions into a
      // write conflict and retries one against the other's committed state.
      await fenceAdminAccessTransaction(session);

      // MongoDB does not support parallel operations on one transaction
      // session. Keep these authorization reads strictly serialized.
      const actor = await Admin.findOne({ _id: actorId, isDeleted: false }).session(session);
      const target = await Admin.findOne({ _id: targetId, isDeleted: false }).session(session);
      const verifiedSuperAdminCount = await Admin.countDocuments({
          role: AdminRole.SUPER_ADMIN,
          isVerified: true,
          isDeleted: false,
        }).session(session);

      const plan = planAdminRoleChange({
        actor: actor ? toSubject(actor) : null,
        nextRole,
        target: target ? toSubject(target) : null,
        verifiedSuperAdminCount,
      });

      if (!target || !plan.changed) {
        if (!target) {
          throw new AdminAccessError('Administrator not found', 404, 'ADMIN_NOT_FOUND');
        }
        result = target;
        return;
      }

      const updatedAdmin = await Admin.findOneAndUpdate(
        {
          _id: targetId,
          isDeleted: false,
          role: target.role,
          isVerified: target.isVerified,
        },
        {
          $set: {
            isVerified: plan.isVerified,
            role: plan.role,
          },
          $inc: { sessionVersion: 1 },
        },
        { new: true, runValidators: true, session }
      );

      if (!updatedAdmin) {
        throw new AdminAccessError(
          'Administrator access changed during this request. Refresh and try again.',
          409,
          'ADMIN_ACCESS_CHANGE_CONFLICT'
        );
      }
      result = updatedAdmin;
    });

    if (!result) {
      throw new AdminAccessError(
        'Administrator access change did not complete. Please retry.',
        409,
        'ADMIN_ACCESS_CHANGE_CONFLICT'
      );
    }
    return result;
  } finally {
    await session.endSession();
  }
};
