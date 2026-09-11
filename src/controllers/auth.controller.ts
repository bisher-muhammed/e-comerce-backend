import { Request, Response, NextFunction } from "express";

import { registerUser } from "../services/auth/register.service";
import { verifyRegistrationOtp } from "../services/auth/verify.service";
import { resendRegistrationOtp } from "../services/auth/resend.service";
import { loginUser } from "../services/auth/login.service";
import { refreshAccessToken } from "../services/auth/refresh.service";
import { logoutUser } from "../services/auth/logout.service";
import prisma from "../config/prisma";
import AppError from "../errors/AppError";
import { accessTokenCookieOptions, clearAuthCookieOptions, refreshTokenCookieOptions, } from "../utils/auth-cookie.util";


export const register = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const registration = await registerUser(req.body);

    return res.status(201).json({
      success: true,
      message: "Verification code sent",
      data: registration,
    });
  } catch (error) {
    next(error);
  }
};

export const verifyOtp = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { registrationToken, otp } = req.body;

    const user = await verifyRegistrationOtp(
      registrationToken,
      otp
    );

    return res.status(201).json({
      success: true,
      message: "Registration successful",
      data: user,
    });
  } catch (error) {
    next(error);
  }
};

export const resendOtp = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { registrationToken } = req.body;

    const result = await resendRegistrationOtp(
      registrationToken
    );

    return res.status(200).json({
      success: true,
      message: result.message,
    });
  } catch (error) {
    next(error);
  }
};

export const login = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const result = await loginUser(req.body);

    res.cookie(
      "access_token",
      result.accessToken,
      accessTokenCookieOptions
    );

    res.cookie(
      "refresh_token",
      result.refreshToken,
      refreshTokenCookieOptions
    );

    return res.status(200).json({
      success: true,
      message: "Login successful",
      data: {
        user: result.user,
      },
    });
  } catch (error) {
    next(error);
  }
};

export const logout = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    res.clearCookie(
      "access_token",
      clearAuthCookieOptions
    );

    res.clearCookie(
      "refresh_token",
      clearAuthCookieOptions
    );

    // Cleared first so the browser is disarmed even if this fails
    await logoutUser(req.cookies.refresh_token);

    return res.status(200).json({
      success: true,
      message: "Logged out successfully",
    });
  } catch (error) {
    next(error);
  }
};


export const getMe = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    if (!req.user) {
      throw new AppError("Unauthorized", 401);
    }

    const user = await prisma.user.findUnique({
      where: { id: req.user.id }, // was req.user.userId
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        status: true,
      },
    });

    if (!user) {
      throw new AppError("Unauthorized", 401);
    }

    if (user.status !== "ACTIVE") {
      throw new AppError("Account is not active", 403);
    }

    return res.status(200).json({
      success: true,
      data: { user },
    });
  } catch (error) {
    next(error);
  }
};


export const refreshToken = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const refreshToken = req.cookies.refresh_token;

    if (!refreshToken) {
      throw new AppError("Refresh token missing", 401);
    }

    const result = await refreshAccessToken(refreshToken);

    res.cookie(
      "access_token",
      result.accessToken,
      accessTokenCookieOptions
    );

    // Rotated on every refresh — the cookie has to move with it
    res.cookie(
      "refresh_token",
      result.refreshToken,
      refreshTokenCookieOptions
    );

    return res.status(200).json({
      success: true,
      message: "Access token refreshed",
    });
  } catch (error) {
    next(error);
  }
};
