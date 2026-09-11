import jwt from "jsonwebtoken";

import { verifyRefreshToken } from "../../utils/jwt";
import { revokeRefreshSession } from "./refresh-session.service";

export const logoutUser = async (
  token: string | undefined
) => {
  if (!token) {
    return;
  }

  let sid: string;
  let userId: number;

  try {
    const decoded = verifyRefreshToken(token, {
      ignoreExpiration: true,
    });

    if (
      typeof decoded.sid !== "string" ||
      typeof decoded.userId !== "number"
    ) {
      return;
    }

    sid = decoded.sid;
    userId = decoded.userId;
  } catch (error) {
    // An unreadable cookie leaves nothing to revoke
    if (error instanceof jwt.JsonWebTokenError) {
      return;
    }

    throw error;
  }

  await revokeRefreshSession(sid, userId);
};
