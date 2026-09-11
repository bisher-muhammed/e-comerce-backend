import jwt from "jsonwebtoken";

const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET!;
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET!;

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const REFRESH_TOKEN_TTL_SECONDS =
  7 * 24 * 60 * 60;

export interface AccessTokenPayload {
  userId: number;
  role: "CUSTOMER" | "ADMIN" | "SUPER_ADMIN";
}

export interface RefreshTokenPayload
  extends AccessTokenPayload {
  sid: string;
  jti: string;
}

export const generateAccessToken = (
  payload: AccessTokenPayload
) => {
  return jwt.sign(payload, JWT_ACCESS_SECRET, {
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
  });
};

export const generateRefreshToken = (
  payload: RefreshTokenPayload
) => {
  return jwt.sign(payload, JWT_REFRESH_SECRET, {
    expiresIn: REFRESH_TOKEN_TTL_SECONDS,
  });
};

export const verifyAccessToken = (
  token: string
): AccessTokenPayload => {
  return jwt.verify(
    token,
    JWT_ACCESS_SECRET
  ) as AccessTokenPayload;
};

export const verifyRefreshToken = (
  token: string,
  options: { ignoreExpiration?: boolean } = {}
): RefreshTokenPayload => {
  return jwt.verify(token, JWT_REFRESH_SECRET, {
    ignoreExpiration: options.ignoreExpiration ?? false,
  }) as RefreshTokenPayload;
};
