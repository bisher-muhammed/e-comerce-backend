class AppError extends Error {
  statusCode: number;

  /** Optional machine-readable reason, e.g. "PRICE_CHANGED". */
  code?: string;

  /** Seconds, sent as a Retry-After header. */
  retryAfterSeconds?: number;

  constructor(
    message: string,
    statusCode: number,
    code?: string,
    retryAfterSeconds?: number
  ) {
    super(message);

    this.statusCode = statusCode;
    this.name = "AppError";

    if (code) {
      this.code = code;
    }

    if (retryAfterSeconds !== undefined) {
      this.retryAfterSeconds = retryAfterSeconds;
    }

    Object.setPrototypeOf(this, AppError.prototype);
  }
}

export default AppError;

