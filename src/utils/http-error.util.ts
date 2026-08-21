export const getPublicErrorMessage = (
  error: unknown,
  environment: string | undefined = process.env.NODE_ENV
): string => {
  if (environment === 'production') return 'Internal Server Error';
  return error instanceof Error && error.message
    ? error.message
    : 'An unexpected error occurred';
};

type ErrorLike = {
  code?: unknown;
  message?: unknown;
  stack?: unknown;
  statusCode?: unknown;
};

const asErrorLike = (error: unknown): ErrorLike | undefined =>
  typeof error === 'object' && error !== null ? (error as ErrorLike) : undefined;

export const getErrorMessage = (error: unknown, fallback: string): string => {
  const message = asErrorLike(error)?.message;
  return typeof message === 'string' && message ? message : fallback;
};

export const getErrorStack = (error: unknown): string | undefined => {
  const stack = asErrorLike(error)?.stack;
  return typeof stack === 'string' ? stack : undefined;
};

export const getErrorStatusCode = (error: unknown, fallback = 500): number => {
  const statusCode = asErrorLike(error)?.statusCode;
  return typeof statusCode === 'number' ? statusCode : fallback;
};

export const hasErrorCode = (error: unknown, code: string | number): boolean =>
  asErrorLike(error)?.code === code;
