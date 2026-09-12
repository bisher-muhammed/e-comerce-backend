import type { CookieOptions } from "express";
import { ACCESS_TOKEN_TTL_SECONDS, REFRESH_TOKEN_TTL_SECONDS, } from "./jwt";
import { REGISTRATION_TTL_SECONDS } from "../services/auth/otp.service";

const cookieDomain = process.env.COOKIE_DOMAIN;

export const REFRESH_TOKEN_COOKIE_PATH = "/api/v1/auth";

export const REGISTRATION_TOKEN_COOKIE = "registration_token";

export const REGISTRATION_TOKEN_COOKIE_PATH = "/api/v1/auth";

const baseCookieOptions: CookieOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    ...(cookieDomain ? { domain: cookieDomain } : {}),
};

export const accessTokenCookieOptions: CookieOptions = {
    ...baseCookieOptions,
    path: "/",
    maxAge: ACCESS_TOKEN_TTL_SECONDS * 1000,
};

export const refreshTokenCookieOptions: CookieOptions = {
    ...baseCookieOptions,
    path: REFRESH_TOKEN_COOKIE_PATH,
    maxAge: REFRESH_TOKEN_TTL_SECONDS * 1000,
};

export const registrationTokenCookieOptions: CookieOptions = {
    ...baseCookieOptions,
    path: REGISTRATION_TOKEN_COOKIE_PATH,
    maxAge: REGISTRATION_TTL_SECONDS * 1000,
};

export const clearRegistrationTokenCookieOptions: CookieOptions = {
    ...baseCookieOptions,
    path: REGISTRATION_TOKEN_COOKIE_PATH,
};

export const clearAccessTokenCookieOptions: CookieOptions = {
    ...baseCookieOptions,
    path: "/",
};

export const clearRefreshTokenCookieOptions: CookieOptions = {
    ...baseCookieOptions,
    path: REFRESH_TOKEN_COOKIE_PATH,
};

export const clearLegacyRefreshTokenCookieOptions: CookieOptions = {
    ...baseCookieOptions,
    path: "/",
};
