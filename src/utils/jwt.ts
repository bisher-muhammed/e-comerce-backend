import jwt from "jsonwebtoken";

const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET!;
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET!;

export interface AccessTokenPayload {
  userId: number;
  role: "CUSTOMER" | "ADMIN" | "SUPER_ADMIN";
}

export const generateAccessToken = (
  payload: AccessTokenPayload
) => {
  return jwt.sign(payload, JWT_ACCESS_SECRET, {
    expiresIn: "15m",
  });
};

export const generateRefreshToken = (
  payload: AccessTokenPayload
) => {
  return jwt.sign(payload, JWT_REFRESH_SECRET, {
    expiresIn: "55m",
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
  token: string
): AccessTokenPayload => {
  return jwt.verify(
    token,
    JWT_REFRESH_SECRET
  ) as AccessTokenPayload;
};
