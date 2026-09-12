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

export const accessTokenCookieName = (
  scope: AuthScope
) => AUTH_COOKIES[scope].access;

export const refreshTokenCookieName = (
  scope: AuthScope
) => AUTH_COOKIES[scope].refresh;

const baseCookieOptions: CookieOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
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

export const registrationTokenCookieOptions: CookieOptions = {
    ...baseCookieOptions,
    path: REGISTRATION_TOKEN_COOKIE_PATH,
    maxAge: REGISTRATION_TTL_SECONDS * 1000,
};

export const clearRegistrationTokenCookieOptions: CookieOptions = {
    ...baseCookieOptions,
    path: REGISTRATION_TOKEN_COOKIE_PATH,
};

export const clearLegacyRefreshTokenCookieOptions: CookieOptions = {
    ...baseCookieOptions,
    path: "/",
};
