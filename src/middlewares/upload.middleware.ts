import multer from "multer";
import { NextFunction, Request, Response } from "express";
import AppError from "../errors/AppError";



const ALLOWED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
];

const MAX_FILE_SIZE = 5 * 1024 * 1024;

export const MAX_PRODUCT_IMAGE_FILES = 20;


const storage = multer.memoryStorage();


const fileFilter = (
  req: Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback
) => {
  if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
    return cb(
      new AppError(
        "Invalid image type. Only JPEG, PNG, and WebP images are allowed.",
        400
      )
    );
  }

  cb(null, true);
};



export const productImageUpload = multer({
  storage,
  fileFilter,

  limits: {
    fileSize: MAX_FILE_SIZE,
    files: MAX_PRODUCT_IMAGE_FILES,
  },
});


const startsWith = (
  buffer: Buffer,
  signature: number[],
  offset = 0
): boolean => {
  if (buffer.length < offset + signature.length) {
    return false;
  }

  return signature.every(
    (byte, index) => buffer[offset + index] === byte
  );
};

const detectImageMimeType = (
  buffer: Buffer
): string | null => {
  if (startsWith(buffer, [0xff, 0xd8, 0xff])) {
    return "image/jpeg";
  }

  if (
    startsWith(buffer, [
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a,
      0x0a,
    ])
  ) {
    return "image/png";
  }

  if (
    startsWith(buffer, [0x52, 0x49, 0x46, 0x46]) &&
    startsWith(
      buffer,
      [0x57, 0x45, 0x42, 0x50],
      8
    )
  ) {
    return "image/webp";
  }

  return null;
};


export const verifyImageContents = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const files =
    (req.files as Express.Multer.File[] | undefined) ??
    [];

  for (const file of files) {
    const detected = detectImageMimeType(file.buffer);

    if (
      detected === null ||
      !ALLOWED_MIME_TYPES.includes(detected)
    ) {
      return next(
        new AppError(
          `"${file.originalname}" is not a valid JPEG, PNG, or WebP image.`,
          400
        )
      );
    }

    file.mimetype = detected;
  }

  next();
};
