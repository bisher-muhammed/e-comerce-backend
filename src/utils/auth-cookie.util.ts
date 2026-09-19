import type { CookieOptions } from "express";
import { ACCESS_TOKEN_TTL_SECONDS, REFRESH_TOKEN_TTL_SECONDS, type AuthScope, } from "./jwt";
import { REGISTRATION_TTL_SECONDS } from "../services/auth/otp.service";

const cookieDomain = process.env.COOKIE_DOMAIN;

export const REGISTRATION_TOKEN_COOKIE = "registration_token";

export const REGISTRATION_TOKEN_COOKIE_PATH = "/api/v1/auth";

const AUTH_COOKIES: Record<
  AuthScope,
  { access: string; refresh: string; refreshPath: string }
> = {
  storefront: {
    access: "access_token",
    refresh: "refresh_token",
    refreshPath: "/api/v1/auth",
  },

  admin: {
    access: "admin_access_token",
    refresh: "admin_refresh_token",
    refreshPath: "/api/v1/auth/admin",
  },
};

/*
 * Session hint cookies. NOT credentials: readable by the frontends'
 * middleware/JS only to decide whether a refresh is worth trying, so a
 * guest page load never fires a refresh that is certain to fail (M5).
 */
const SESSION_HINT_COOKIES: Record<AuthScope, string> = {
  storefront: "session",
  admin: "admin_session",
};

export const sessionHintCookieName = (scope: AuthScope) =>
  SESSION_HINT_COOKIES[scope];

export const accessTokenCookieName = (
  scope: AuthScope
) => AUTH_COOKIES[scope].access;

export const refreshTokenCookieName = (
  scope: AuthScope
) => AUTH_COOKIES[scope].refresh;

/*
 * Secure by default (M8): a deployment that forgets NODE_ENV must not send
 * session cookies over plain HTTP. Local HTTP development can opt out with
 * COOKIE_INSECURE_DEV=true (refused at start-up in production). Browsers
 * treat http://localhost as secure, so most local setups need no flag.
 */
const cookiesSecure =
    process.env.COOKIE_INSECURE_DEV !== "true" ||
    process.env.NODE_ENV === "production";

const baseCookieOptions: CookieOptions = {
    httpOnly: true,
    secure: cookiesSecure,
    sameSite: "lax",
    ...(cookieDomain ? { domain: cookieDomain } : {}),
};

export const accessTokenCookieOptions = (
  _scope: AuthScope
): CookieOptions => ({
    ...baseCookieOptions,
    path: "/",
    maxAge: ACCESS_TOKEN_TTL_SECONDS * 1000,
});

export const refreshTokenCookieOptions = (
  scope: AuthScope
): CookieOptions => ({
    ...baseCookieOptions,
    path: AUTH_COOKIES[scope].refreshPath,
    maxAge: REFRESH_TOKEN_TTL_SECONDS * 1000,
});

export const clearAccessTokenCookieOptions = (
  _scope: AuthScope
): CookieOptions => ({
    ...baseCookieOptions,
    path: "/",
});

export const clearRefreshTokenCookieOptions = (
  scope: AuthScope
): CookieOptions => ({
    ...baseCookieOptions,
    path: AUTH_COOKIES[scope].refreshPath,
});

export const sessionHintCookieOptions = (): CookieOptions => ({
    ...baseCookieOptions,
    httpOnly: false,
    path: "/",
    maxAge: REFRESH_TOKEN_TTL_SECONDS * 1000,
});

export const clearSessionHintCookieOptions = (): CookieOptions => ({
    ...baseCookieOptions,
    httpOnly: false,
    path: "/",
});

export const registrationTokenCookieOptions: CookieOptions = {
    ...baseCookieOptions,
    path: REGISTRATION_TOKEN_COOKIE_PATH,
    maxAge: REGISTRATION_TTL_SECONDS * 1000,
};

export const clearRegistrationTokenCookieOptions: CookieOptions = {
    ...baseCookieOptions,
    path: REGISTRATION_TOKEN_COOKIE_PATH,
};

// Admin second-factor challenge: only sent back to the MFA endpoint.
export const ADMIN_MFA_CHALLENGE_COOKIE = "admin_mfa_challenge";

export const adminMfaChallengeCookieOptions: CookieOptions = {
    ...baseCookieOptions,
    path: "/api/v1/auth/admin/login",
    maxAge: 5 * 60 * 1000,
};

export const clearAdminMfaChallengeCookieOptions: CookieOptions = {
    ...baseCookieOptions,
    path: "/api/v1/auth/admin/login",
};

export const clearLegacyRefreshTokenCookieOptions: CookieOptions = {
    ...baseCookieOptions,
    path: "/",
};
