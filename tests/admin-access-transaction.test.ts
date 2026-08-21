jest.mock('mongoose', () => {
  const actual = jest.requireActual('mongoose');
  return {
    ...actual,
    __esModule: true,
    default: { ...actual.default, startSession: jest.fn() },
  };
});

jest.mock('@/models/admin.model', () => ({
  __esModule: true,
  AdminRole: { SUPER_ADMIN: 'super_admin', ADMIN: 'admin', VIEWER: 'viewer' },
  default: {
    countDocuments: jest.fn(),
    findOne: jest.fn(),
    findOneAndUpdate: jest.fn(),
  },
}));

jest.mock('@/models/admin-access-control.model', () => ({
  __esModule: true,
  default: { updateOne: jest.fn() },
}));

import mongoose from 'mongoose';
import Admin, { AdminRole } from '@/models/admin.model';
import AdminAccessControl from '@/models/admin-access-control.model';
import { changeAdminRole } from '@/services/admin-access.service';

const mockedAdmin = Admin as unknown as {
  countDocuments: jest.Mock;
  findOne: jest.Mock;
  findOneAndUpdate: jest.Mock;
};
const mockedAccessControl = AdminAccessControl as unknown as { updateOne: jest.Mock };
const mockedStartSession = mongoose.startSession as jest.MockedFunction<
  typeof mongoose.startSession
>;

const session = {
  endSession: jest.fn().mockResolvedValue(undefined),
  withTransaction: jest.fn(async (operation: () => Promise<void>) => operation()),
};

const sessionQuery = <T>(value: T) => ({
  session: jest.fn().mockResolvedValue(value),
});

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((fulfill) => {
    resolve = fulfill;
  });
  return { promise, resolve };
};

const flushMicrotasks = async () => {
  await new Promise<void>((resolve) => setImmediate(resolve));
};

describe('administrator role transaction fencing', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedStartSession.mockResolvedValue(session as never);
    mockedAccessControl.updateOne
      .mockResolvedValueOnce({ acknowledged: true })
      .mockResolvedValueOnce({ matchedCount: 1 });
    mockedAdmin.findOne
      .mockReturnValueOnce(
        sessionQuery({
          _id: { toString: () => 'actor' },
          isDeleted: false,
          isVerified: true,
          role: AdminRole.SUPER_ADMIN,
        })
      )
      .mockReturnValueOnce(
        sessionQuery({
          _id: { toString: () => 'target' },
          isDeleted: false,
          isVerified: true,
          role: AdminRole.SUPER_ADMIN,
        })
      );
    mockedAdmin.countDocuments.mockReturnValue(sessionQuery(2));
    mockedAdmin.findOneAndUpdate.mockResolvedValue({
      _id: 'target',
      role: AdminRole.ADMIN,
      isVerified: true,
    });
  });

  it('serializes the last-super check with a durable in-transaction fence', async () => {
    await expect(changeAdminRole('actor', 'target', AdminRole.ADMIN)).resolves.toMatchObject({
      role: AdminRole.ADMIN,
    });

    expect(session.withTransaction).toHaveBeenCalledTimes(1);
    expect(mockedAccessControl.updateOne).toHaveBeenNthCalledWith(
      2,
      { _id: 'admin-role-management' },
      { $inc: { revision: 1 } },
      { session }
    );
    expect(mockedAdmin.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ _id: 'target', role: AdminRole.SUPER_ADMIN }),
      expect.objectContaining({ $inc: { sessionVersion: 1 } }),
      expect.objectContaining({ session })
    );
    expect(mockedAccessControl.updateOne.mock.calls.flat()).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ lockedUntil: expect.anything() })])
    );
    expect(session.endSession).toHaveBeenCalledTimes(1);
  });

  it('does not start the next authorization read before the prior session read resolves', async () => {
    const actorRead = deferred<{
      _id: { toString: () => string };
      isDeleted: boolean;
      isVerified: boolean;
      role: AdminRole;
    }>();
    const targetRead = deferred<{
      _id: { toString: () => string };
      isDeleted: boolean;
      isVerified: boolean;
      role: AdminRole;
    }>();
    const countRead = deferred<number>();
    mockedAdmin.findOne.mockReset();
    mockedAdmin.findOne
      .mockReturnValueOnce({ session: jest.fn().mockReturnValue(actorRead.promise) })
      .mockReturnValueOnce({ session: jest.fn().mockReturnValue(targetRead.promise) });
    mockedAdmin.countDocuments.mockReset().mockReturnValue({
      session: jest.fn().mockReturnValue(countRead.promise),
    });

    const operation = changeAdminRole('actor', 'target', AdminRole.ADMIN);
    await flushMicrotasks();
    expect(mockedAdmin.findOne).toHaveBeenCalledTimes(1);
    expect(mockedAdmin.countDocuments).not.toHaveBeenCalled();

    actorRead.resolve({
      _id: { toString: () => 'actor' },
      isDeleted: false,
      isVerified: true,
      role: AdminRole.SUPER_ADMIN,
    });
    await flushMicrotasks();
    expect(mockedAdmin.findOne).toHaveBeenCalledTimes(2);
    expect(mockedAdmin.countDocuments).not.toHaveBeenCalled();

    targetRead.resolve({
      _id: { toString: () => 'target' },
      isDeleted: false,
      isVerified: true,
      role: AdminRole.SUPER_ADMIN,
    });
    await flushMicrotasks();
    expect(mockedAdmin.countDocuments).toHaveBeenCalledTimes(1);

    countRead.resolve(2);
    await expect(operation).resolves.toMatchObject({ role: AdminRole.ADMIN });
  });
});
