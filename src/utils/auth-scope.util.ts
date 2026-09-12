import AppError from "../errors/AppError";
import type { AuthScope, UserRole } from "./jwt";

const SCOPE_ROLES: Record<AuthScope, readonly UserRole[]> = {
  storefront: ["CUSTOMER"],
  admin: ["ADMIN", "SUPER_ADMIN"],
};

export const isRoleInScope = (
  role: UserRole,
  scope: AuthScope
): boolean => {
  return SCOPE_ROLES[scope].includes(role);
};

/*
 * The storefront refusal is deliberately identical to a wrong password:
 * a public login form must not confirm that an address belongs to an
 * admin. The admin portal is internal, so it can say what is wrong.
 */
export const assertRoleInScope = (
  role: UserRole,
  scope: AuthScope
) => {
  if (isRoleInScope(role, scope)) {
    return;
  }

  if (scope === "admin") {
    throw new AppError(
      "This account does not have admin access",
      403
    );
  }

  throw new AppError("Invalid email or password", 401);
};
