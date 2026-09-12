import jwt from "jsonwebtoken";

const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET!;
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET!;

const JWT_ALGORITHM = "HS256" as const;

const JWT_ISSUER =
  process.env.JWT_ISSUER ?? "e-commerce-api";

const JWT_AUDIENCE =
  process.env.JWT_AUDIENCE ?? "e-commerce-client";

const ACCESS_TOKEN_TYPE = "access" as const;
const REFRESH_TOKEN_TYPE = "refresh" as const;

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

type SignedPayload<T> = T & {
  typ:
    | typeof ACCESS_TOKEN_TYPE
    | typeof REFRESH_TOKEN_TYPE;
};

const signOptions = (
  expiresIn: number
): jwt.SignOptions => ({
  algorithm: JWT_ALGORITHM,
  issuer: JWT_ISSUER,
  audience: JWT_AUDIENCE,
  expiresIn,
});

const verifyOptions = (
  ignoreExpiration: boolean
): jwt.VerifyOptions => ({
  algorithms: [JWT_ALGORITHM],
  issuer: JWT_ISSUER,
  audience: JWT_AUDIENCE,
  ignoreExpiration,
});

const assertTokenType = <T>(
  payload: SignedPayload<T>,
  expected: SignedPayload<T>["typ"]
): T => {
  if (payload.typ !== expected) {
    throw new jwt.JsonWebTokenError(
      "Unexpected token type"
    );
  }

  return payload;
};

export const generateAccessToken = (
  payload: AccessTokenPayload
) => {
  return jwt.sign(
    { ...payload, typ: ACCESS_TOKEN_TYPE },
    JWT_ACCESS_SECRET,
    signOptions(ACCESS_TOKEN_TTL_SECONDS)
  );
};

export const generateRefreshToken = (
  payload: RefreshTokenPayload
) => {
  return jwt.sign(
    { ...payload, typ: REFRESH_TOKEN_TYPE },
    JWT_REFRESH_SECRET,
    signOptions(REFRESH_TOKEN_TTL_SECONDS)
  );
};

export const verifyAccessToken = (
  token: string
): AccessTokenPayload => {
  const payload = jwt.verify(
    token,
    JWT_ACCESS_SECRET,
    verifyOptions(false)
  ) as SignedPayload<AccessTokenPayload>;

  return assertTokenType(
    payload,
    ACCESS_TOKEN_TYPE
  );
};

export const verifyRefreshToken = (
  token: string,
  options: { ignoreExpiration?: boolean } = {}
): RefreshTokenPayload => {
  const payload = jwt.verify(
    token,
    JWT_REFRESH_SECRET,
    verifyOptions(options.ignoreExpiration ?? false)
  ) as SignedPayload<RefreshTokenPayload>;

  return assertTokenType(
    payload,
    REFRESH_TOKEN_TYPE
  );
};
