// A friendly error we deliberately show to the user (e.g. "Wrong password").
export class AppError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export const badRequest = (code: string, msg: string) => new AppError(400, code, msg);
export const unauthorized = (msg = 'Please log in again') => new AppError(401, 'unauthorized', msg);
export const forbidden = (msg = 'You do not have permission to do this') => new AppError(403, 'forbidden', msg);
export const notFound = (msg = 'Not found') => new AppError(404, 'not_found', msg);
export const tooMany = (msg: string) => new AppError(429, 'too_many_requests', msg);
