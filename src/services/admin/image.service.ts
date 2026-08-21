import cloudinary from "../../config/cloudinary";
import AppError from "../../errors/AppError";

export interface UploadedImage {
  url: string;
  publicId: string;
}

const uploadImage = (
  file: Express.Multer.File
): Promise<UploadedImage> => {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: "ecommerce/products",
        resource_type: "image",
      },

      (error, result) => {
        if (error || !result) {
          reject(
            new AppError(
              `Failed to upload image${
                error ? `: ${error.message}` : ""
              }`,
              500
            )
          );

          return;
        }

        resolve({
          url: result.secure_url,
          publicId: result.public_id,
        });
      }
    );

    uploadStream.end(file.buffer);
  });
};


export const uploadImagesToStorage = async (
  files: Express.Multer.File[]
): Promise<UploadedImage[]> => {
  if (!files || files.length === 0) {
    throw new AppError("No images were provided", 400);
  }

  const results = await Promise.allSettled(
    files.map((file) => uploadImage(file))
  );

  const successfulUploads: UploadedImage[] = [];

  let hasFailure = false;

  results.forEach((result, index) => {
    if (result.status === "fulfilled") {
      successfulUploads.push(result.value);
    } else {
      hasFailure = true;

      console.error(
        `Failed to upload image (index ${index}, name "${
          files[index]?.originalname ?? "unknown"
        }"):`,
        result.reason
      );
    }
  });

  if (hasFailure) {
    if (successfulUploads.length > 0) {
      const ids = successfulUploads.map((image) => image.publicId);

      const cleanupResults = await Promise.allSettled(
        ids.map((publicId) => deleteImageFromStorage(publicId))
      );

      cleanupResults.forEach((result, index) => {
        if (result.status === "rejected") {
          console.error(
            `Failed to roll back uploaded image ${ids[index]}:`,
            result.reason
          );
        }
      });
    }

    throw new AppError(
      "Failed to upload one or more product images",
      500
    );
  }

  return successfulUploads;
};



export const deleteImageFromStorage = async (
  publicId: string
): Promise<void> => {
  if (!publicId.trim()) {
    throw new AppError("Image public ID is required", 400);
  }

  try {
    const result = await cloudinary.uploader.destroy(publicId, {
      resource_type: "image",
    });

    if (result.result !== "ok" && result.result !== "not found") {
      throw new AppError("Failed to delete image", 500);
    }
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    throw new AppError("Failed to delete image from storage", 500);
  }
};
