import multer from "multer";
import { Request } from "express";
import AppError from "../errors/AppError";



const ALLOWED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
];

const MAX_FILE_SIZE = 5 * 1024 * 1024;


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
    files: 200,
  },
});
