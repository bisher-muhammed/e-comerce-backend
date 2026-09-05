declare global {
  namespace Express {
    interface Request {
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
      };
    }
  }
}

export {};
