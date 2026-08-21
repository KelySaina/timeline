export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new HttpError(400, message, 'bad_request', details);
export const unauthorized = (message = 'Sign in to continue') =>
  new HttpError(401, message, 'unauthorized');
export const forbidden = (message = 'You do not have access to this') =>
  new HttpError(403, message, 'forbidden');
export const notFound = (message = 'Not found') => new HttpError(404, message, 'not_found');
export const conflict = (message: string, code = 'conflict') => new HttpError(409, message, code);
export const tooLarge = (message: string) => new HttpError(413, message, 'payload_too_large');
