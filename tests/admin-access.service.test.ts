import { AdminRole } from '@/models/admin.model';
import {
  AdminAccessError,
  AdminAccessSubject,
  planAdminRoleChange,
} from '@/services/admin-access.service';
import { adminRoleUpdateSchema } from '@/validators/auth.validator';

const subject = (
  id: string,
  role: AdminRole,
  overrides: Partial<AdminAccessSubject> = {}
): AdminAccessSubject => ({
  id,
  isDeleted: false,
  isVerified: true,
  role,
  ...overrides,
});

describe('administrator access policy', () => {
  const superAdmin = subject('super-1', AdminRole.SUPER_ADMIN);

  it('allows only a verified Super Admin to change roles', () => {
    expect(() =>
      planAdminRoleChange({
        actor: subject('admin-1', AdminRole.ADMIN),
        nextRole: AdminRole.SUPER_ADMIN,
        target: subject('admin-2', AdminRole.ADMIN),
        verifiedSuperAdminCount: 1,
      })
    ).toThrow(
      expect.objectContaining<Partial<AdminAccessError>>({
        code: 'ADMIN_ROLE_CHANGE_FORBIDDEN',
        statusCode: 403,
      })
    );
  });

  it('prevents self-demotion', () => {
    expect(() =>
      planAdminRoleChange({
        actor: superAdmin,
        nextRole: AdminRole.ADMIN,
        target: superAdmin,
        verifiedSuperAdminCount: 2,
      })
    ).toThrow(
      expect.objectContaining<Partial<AdminAccessError>>({
        code: 'ADMIN_SELF_DEMOTION_FORBIDDEN',
        statusCode: 409,
      })
    );
  });

  it('prevents removal of the last verified Super Admin', () => {
    expect(() =>
      planAdminRoleChange({
        actor: subject('super-2', AdminRole.SUPER_ADMIN),
        nextRole: AdminRole.ADMIN,
        target: superAdmin,
        verifiedSuperAdminCount: 1,
      })
    ).toThrow(
      expect.objectContaining<Partial<AdminAccessError>>({
        code: 'LAST_SUPER_ADMIN_REQUIRED',
        statusCode: 409,
      })
    );
  });

  it('verifies a viewer when granting admin power', () => {
    expect(
      planAdminRoleChange({
        actor: superAdmin,
        nextRole: AdminRole.ADMIN,
        target: subject('viewer-1', AdminRole.VIEWER, { isVerified: false }),
        verifiedSuperAdminCount: 1,
      })
    ).toEqual({ changed: true, isVerified: true, role: AdminRole.ADMIN });
  });

  it('revokes admin power without disabling the account', () => {
    expect(
      planAdminRoleChange({
        actor: superAdmin,
        nextRole: AdminRole.VIEWER,
        target: subject('admin-1', AdminRole.ADMIN),
        verifiedSuperAdminCount: 1,
      })
    ).toEqual({ changed: true, isVerified: true, role: AdminRole.VIEWER });
  });

  it('accepts only known role values in the HTTP payload', () => {
    expect(adminRoleUpdateSchema.parse({ role: 'admin' })).toEqual({ role: 'admin' });
    expect(() => adminRoleUpdateSchema.parse({ role: 'owner' })).toThrow();
    expect(() => adminRoleUpdateSchema.parse({ role: 'admin', isVerified: true })).toThrow();
  });
});
