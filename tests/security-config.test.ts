import {
  ClientOriginConfigurationError,
  getAllowedClientOrigins,
  getFrontendOrigin,
  parseClientOrigins,
  parseHttpOrigin,
} from '@/utils/client-origin.util';
import { getPublicErrorMessage } from '@/utils/http-error.util';
import {
  ADMIN_BOOTSTRAP_CLAIM,
  ADMIN_BOOTSTRAP_INDEX,
  bootstrapSecretsMatch,
  isBootstrapClaimConflict,
} from '@/utils/admin-bootstrap.util';
import { envSchema } from '@/utils/env.validator';

describe('client origin configuration', () => {
  it('normalizes, de-duplicates, and preserves exact http(s) origins', () => {
    expect(
      parseClientOrigins(
        'https://Example.COM:443/, http://localhost:3000, https://example.com'
      )
    ).toEqual(['https://example.com', 'http://localhost:3000']);
  });

  it('uses only the local development origin when CLIENT_URL is absent', () => {
    expect(getAllowedClientOrigins(undefined)).toEqual(['http://localhost:3000']);
  });

  it('normalizes one frontend origin and falls back to the first client origin', () => {
    expect(parseHttpOrigin('https://Example.com:443/', 'FRONTEND_URL')).toBe(
      'https://example.com'
    );
    expect(getFrontendOrigin(undefined, 'https://primary.example,https://other.example')).toBe(
      'https://primary.example'
    );
  });

  it.each([
    'https://example.com,',
    'https://example.com/app',
    'https://example.com/app/..',
    'https://example.com/%2e',
    'https://user:secret@example.com',
    'https://example.com?source=test',
    'https://example.com#section',
    'ftp://example.com',
    'https:\\example.com',
    'not a url',
  ])('rejects a non-origin CLIENT_URL entry: %s', (value) => {
    expect(() => parseClientOrigins(value)).toThrow(ClientOriginConfigurationError);
  });

  it('reuses strict origin parsing in environment validation', () => {
    const baseEnvironment = {
      NODE_ENV: 'test',
      PORT: '5000',
      MONGODB_URI: 'mongodb://localhost:27017/test',
      JWT_SECRET: 'a'.repeat(32),
      JWT_REFRESH_SECRET: 'b'.repeat(32),
      CLOUDINARY_URL: 'https://example.com/cloudinary',
    };

    expect(
      envSchema.safeParse({ ...baseEnvironment, CLIENT_URL: 'https://example.com' }).success
    ).toBe(true);
    expect(
      envSchema.safeParse({ ...baseEnvironment, CLIENT_URL: 'https://example.com/app' }).success
    ).toBe(false);
    expect(
      envSchema.safeParse({
        ...baseEnvironment,
        CLIENT_URL: 'https://example.com',
        FRONTEND_URL: 'https://user@example.com/reset-base',
      }).success
    ).toBe(false);
    expect(
      envSchema.safeParse({
        ...baseEnvironment,
        CLIENT_URL: 'https://example.com',
        ADMIN_BOOTSTRAP_SECRET: 'too-short',
      }).success
    ).toBe(false);
  });

  it('accepts MongoDB SRV and multi-host seed-list connection strings', () => {
    const baseEnvironment = {
      NODE_ENV: 'test',
      PORT: '5000',
      JWT_SECRET: 'a'.repeat(32),
      JWT_REFRESH_SECRET: 'b'.repeat(32),
      CLIENT_URL: 'http://localhost:3000',
      CLOUDINARY_URL: 'https://example.com/cloudinary',
    };

    expect(
      envSchema.safeParse({
        ...baseEnvironment,
        MONGODB_URI: 'mongodb+srv://user:password@cluster.example.com/test',
      }).success
    ).toBe(true);
    expect(
      envSchema.safeParse({
        ...baseEnvironment,
        MONGODB_URI:
          'mongodb://user:password@db-00.example.com:27017,db-01.example.com:27017/test?replicaSet=example&tls=true',
      }).success
    ).toBe(true);
    expect(
      envSchema.safeParse({
        ...baseEnvironment,
        MONGODB_URI: 'https://example.com/not-mongodb',
      }).success
    ).toBe(false);
  });
});

describe('security response helpers', () => {
  it('does not expose unexpected error details in production', () => {
    expect(getPublicErrorMessage(new Error('database topology details'), 'production')).toBe(
      'Internal Server Error'
    );
    expect(getPublicErrorMessage(new Error('useful local detail'), 'development')).toBe(
      'useful local detail'
    );
  });

  it('compares bootstrap secrets without accepting missing or different values', () => {
    const secret = 'correct-horse-battery-staple-bootstrap-secret';
    expect(bootstrapSecretsMatch(secret, secret)).toBe(true);
    expect(bootstrapSecretsMatch(`${secret}!`, secret)).toBe(false);
    expect(bootstrapSecretsMatch(undefined, secret)).toBe(false);
    expect(bootstrapSecretsMatch(secret, undefined)).toBe(false);
  });

  it('distinguishes a bootstrap-claim race from another duplicate key', () => {
    expect(
      isBootstrapClaimConflict({
        code: 11000,
        keyValue: { bootstrapClaim: ADMIN_BOOTSTRAP_CLAIM },
      })
    ).toBe(true);
    expect(
      isBootstrapClaimConflict({
        code: 11000,
        message: `duplicate key index: ${ADMIN_BOOTSTRAP_INDEX}`,
      })
    ).toBe(true);
    expect(isBootstrapClaimConflict({ code: 11000, keyPattern: { email: 1 } })).toBe(false);
  });
});
