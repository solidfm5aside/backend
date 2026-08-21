jest.mock('@/models/admin.model', () => ({
  __esModule: true,
  AdminRole: {
    SUPER_ADMIN: 'super_admin',
    ADMIN: 'admin',
    VIEWER: 'viewer',
  },
  default: {
    exists: jest.fn(),
    create: jest.fn(),
    collection: {
      createIndex: jest.fn(),
    },
  },
}));

import Admin from '@/models/admin.model';
import {
  AdminRegistrationError,
  registerAdmin,
} from '@/services/auth-registration.service';
import { ADMIN_BOOTSTRAP_CLAIM } from '@/utils/admin-bootstrap.util';

const mockedAdmin = Admin as unknown as {
  exists: jest.Mock;
  create: jest.Mock;
  collection: { createIndex: jest.Mock };
};

const registration = {
  name: 'Initial Admin',
  email: 'admin@example.com',
  password: 'a-secure-password',
};
const configuredSecret = 'a'.repeat(40);

describe('admin registration bootstrap', () => {
  const originalSecret = process.env.ADMIN_BOOTSTRAP_SECRET;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.ADMIN_BOOTSTRAP_SECRET = configuredSecret;
  });

  afterAll(() => {
    if (originalSecret === undefined) delete process.env.ADMIN_BOOTSTRAP_SECRET;
    else process.env.ADMIN_BOOTSTRAP_SECRET = originalSecret;
  });

  it('keeps established-database registrations pending regardless of bootstrap input', async () => {
    const pendingAdmin = { _id: 'pending' };
    mockedAdmin.exists.mockResolvedValue({ _id: 'existing' });
    mockedAdmin.create.mockResolvedValue(pendingAdmin);

    await expect(registerAdmin(registration, configuredSecret)).resolves.toEqual({
      admin: pendingAdmin,
      isFirstAdmin: false,
    });
    expect(mockedAdmin.create).toHaveBeenCalledWith({
      ...registration,
      role: 'viewer',
      isVerified: false,
    });
    expect(mockedAdmin.collection.createIndex).not.toHaveBeenCalled();
  });

  it('fails closed when an empty database has no configured bootstrap secret', async () => {
    delete process.env.ADMIN_BOOTSTRAP_SECRET;
    mockedAdmin.exists.mockResolvedValue(null);

    const error = await registerAdmin(registration).catch((caught) => caught);
    expect(error).toBeInstanceOf(AdminRegistrationError);
    expect(error).toMatchObject({
      statusCode: 503,
      code: 'ADMIN_BOOTSTRAP_NOT_CONFIGURED',
    });
    expect(mockedAdmin.create).not.toHaveBeenCalled();
  });

  it('rejects a missing or incorrect bootstrap secret before creating an admin', async () => {
    mockedAdmin.exists.mockResolvedValue(null);

    await expect(registerAdmin(registration, 'wrong-secret')).rejects.toMatchObject({
      statusCode: 403,
      code: 'ADMIN_BOOTSTRAP_AUTH_REQUIRED',
    });
    expect(mockedAdmin.collection.createIndex).not.toHaveBeenCalled();
    expect(mockedAdmin.create).not.toHaveBeenCalled();
  });

  it('creates one verified super admin with the unique bootstrap claim', async () => {
    const initialAdmin = { _id: 'initial' };
    mockedAdmin.exists.mockResolvedValue(null);
    mockedAdmin.collection.createIndex.mockResolvedValue('one_initial_admin_bootstrap');
    mockedAdmin.create.mockResolvedValue(initialAdmin);

    await expect(registerAdmin(registration, configuredSecret)).resolves.toEqual({
      admin: initialAdmin,
      isFirstAdmin: true,
    });
    expect(mockedAdmin.create).toHaveBeenCalledWith({
      ...registration,
      role: 'super_admin',
      isVerified: true,
      bootstrapClaim: ADMIN_BOOTSTRAP_CLAIM,
    });
  });

  it('turns a losing concurrent bootstrap request into a pending registration', async () => {
    const pendingAdmin = { _id: 'pending' };
    mockedAdmin.exists
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ _id: 'winning-admin' });
    mockedAdmin.collection.createIndex.mockResolvedValue('one_initial_admin_bootstrap');
    mockedAdmin.create
      .mockRejectedValueOnce({
        code: 11000,
        keyValue: { bootstrapClaim: ADMIN_BOOTSTRAP_CLAIM },
      })
      .mockResolvedValueOnce(pendingAdmin);

    await expect(registerAdmin(registration, configuredSecret)).resolves.toEqual({
      admin: pendingAdmin,
      isFirstAdmin: false,
    });
    expect(mockedAdmin.create).toHaveBeenLastCalledWith({
      ...registration,
      role: 'viewer',
      isVerified: false,
    });
  });
});
