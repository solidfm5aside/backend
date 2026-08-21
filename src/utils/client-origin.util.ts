const DEFAULT_CLIENT_ORIGINS = ['http://localhost:3000'] as const;

export class ClientOriginConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ClientOriginConfigurationError';
  }
}

export const parseHttpOrigin = (
  rawValue: string,
  variableName = 'CLIENT_URL'
): string => {
  const value = rawValue.trim();
  if (!value) {
    throw new ClientOriginConfigurationError(`${variableName} contains an empty origin`);
  }

  if (value.includes('?') || value.includes('#')) {
    throw new ClientOriginConfigurationError(
      `${variableName} entry "${value}" must not contain a query string or fragment`
    );
  }
  if (!/^https?:\/\//i.test(value)) {
    throw new ClientOriginConfigurationError(
      `${variableName} entry "${value}" must use http or https`
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new ClientOriginConfigurationError(
      `${variableName} entry "${value}" is not a valid URL`
    );
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new ClientOriginConfigurationError(
      `${variableName} entry "${value}" must use http or https`
    );
  }
  if (parsed.username || parsed.password) {
    throw new ClientOriginConfigurationError(
      `${variableName} entry "${value}" must not contain credentials`
    );
  }
  const authorityAndPath = value.slice(value.indexOf('://') + 3);
  const pathStart = authorityAndPath.indexOf('/');
  if (
    parsed.pathname !== '/' ||
    (pathStart >= 0 && authorityAndPath.slice(pathStart) !== '/')
  ) {
    throw new ClientOriginConfigurationError(
      `${variableName} entry "${value}" must be an origin without a path`
    );
  }

  return parsed.origin;
};

/**
 * Parses a comma-separated CLIENT_URL value into canonical URL origins.
 * Empty entries are rejected instead of being silently dropped so a malformed
 * allow-list cannot accidentally deploy with a different scope than intended.
 */
export const parseClientOrigins = (value: string): string[] => {
  const rawEntries = value.split(',');
  if (rawEntries.length === 0) {
    throw new ClientOriginConfigurationError('CLIENT_URL must contain at least one origin');
  }

  return [...new Set(rawEntries.map((entry) => parseHttpOrigin(entry, 'CLIENT_URL')))];
};

export const getAllowedClientOrigins = (
  value: string | undefined = process.env.CLIENT_URL
): string[] =>
  value === undefined ? [...DEFAULT_CLIENT_ORIGINS] : parseClientOrigins(value);

export const getFrontendOrigin = (
  frontendUrl: string | undefined = process.env.FRONTEND_URL,
  clientUrl: string | undefined = process.env.CLIENT_URL
): string =>
  frontendUrl === undefined
    ? getAllowedClientOrigins(clientUrl)[0]
    : parseHttpOrigin(frontendUrl, 'FRONTEND_URL');
