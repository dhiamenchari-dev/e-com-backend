export class HttpError extends Error {
  status: number;
  code?: string;
  details?: unknown;

  constructor(
    status: number,
    message: string,
    options?: { code?: string; details?: unknown }
  ) {
    super(message);
    this.status = status;
    this.code = options?.code;
    this.details = options?.details;
  }
}

