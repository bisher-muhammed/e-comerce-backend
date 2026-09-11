import type { CookieOptions } from "express";

const cookieDomain = process.env.COOKIE_DOMAIN;

const baseCookieOptions: CookieOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    ...(cookieDomain ? { domain: cookieDomain } : {}),
};

export const accessTokenCookieOptions: CookieOptions = {
    ...baseCookieOptions,
    maxAge: 15 * 60 * 1000, // 15 minutes
};

export const refreshTokenCookieOptions: CookieOptions = {
    ...baseCookieOptions,
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
};
