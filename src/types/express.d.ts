declare global {
  namespace Express {
    interface Request {
      /** Correlation id, echoed as X-Request-Id and put on every log line. */
      id?: string;

      validated?: {
        body?: unknown;
        params?: unknown;
        query?: unknown;
      };
      user?: {
        id: number;
        email: string;
        firstName: string;
        lastName: string | null;
        role: "CUSTOMER" | "ADMIN" | "SUPER_ADMIN";
        status:
          | "PENDING_VERIFICATION"
          | "ACTIVE"
          | "SUSPENDED"
          | "DEACTIVATED";
        mfaEnabled?: boolean;
        permissions?: string[];
      };
    }
  }
}

export {};
