import type { Request, Response, CookieOptions } from 'express';

export const ACCESS_COOKIE_NAME = 'sfm_access';
export const REFRESH_COOKIE_NAME = 'sfm_refresh';

const durationInMilliseconds = (value: string | undefined, fallback: number): number => {
  if (!value) return fallback;

  const match = /^(\d+)(s|m|h|d)$/i.exec(value.trim());
  if (!match) return fallback;

  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  const multiplier = unit === 's'
    ? 1_000
    : unit === 'm'
      ? 60_000
      : unit === 'h'
        ? 3_600_000
        : 86_400_000;

  return amount * multiplier;
};

const sameSite = (): CookieOptions['sameSite'] => {
  const configured = process.env.COOKIE_SAME_SITE?.toLowerCase();
  if (configured === 'strict' || configured === 'lax' || configured === 'none') {
    return configured;
  }

  return process.env.NODE_ENV === 'production' ? 'none' : 'lax';
};

const cookieOptions = (path: string, maxAge: number): CookieOptions => {
  const selectedSameSite = sameSite();
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production' || selectedSameSite === 'none',
    sameSite: selectedSameSite,
    path,
    maxAge,
  };
};

export const setAuthCookies = (
  res: Response,
  accessToken: string,
  refreshToken: string
): void => {
  res.cookie(
    ACCESS_COOKIE_NAME,
    accessToken,
    cookieOptions('/', durationInMilliseconds(process.env.JWT_EXPIRE, 15 * 60_000))
  );
  res.cookie(
    REFRESH_COOKIE_NAME,
    refreshToken,
    cookieOptions('/api/v1/auth', durationInMilliseconds(process.env.JWT_REFRESH_EXPIRE, 7 * 86_400_000))
  );
};

export const clearAuthCookies = (res: Response): void => {
  const accessOptions = cookieOptions('/', 0);
  const refreshOptions = cookieOptions('/api/v1/auth', 0);
  delete accessOptions.maxAge;
  delete refreshOptions.maxAge;
  res.clearCookie(ACCESS_COOKIE_NAME, accessOptions);
  res.clearCookie(REFRESH_COOKIE_NAME, refreshOptions);
};

export const readCookie = (req: Request, name: string): string | undefined => {
  const header = req.headers.cookie;
  if (!header) return undefined;

  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;

    const key = part.slice(0, separator).trim();
    if (key !== name) continue;

    const value = part.slice(separator + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return undefined;
    }
  }

  return undefined;
};
