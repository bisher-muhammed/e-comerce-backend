import {
  Request,
  Response,
  NextFunction,
} from "express";

import {
  createProduct,
  listProducts,
  getProductById,
  updateProduct,
  deleteProduct,
  validateCategory,
  validateProductUniqueness,
  type CreateProductInput,
  type UpdateProductInput,
} from "../services/admin/product.service";

import {
  uploadImagesToStorage,
  deleteImageFromStorage,
} from "../services/admin/image.service";

import {
  createProductSchema,
  updateProductSchema,
  type ProductIdParam,
  type ListProductsQuery,
  type CreateProductImage,
  type UpdateProductImage,
} from "../validations/product.validation";

import { validated } from "../middlewares/validate.middleware";

import AppError from "../errors/AppError";


const parseMetadata = (value: unknown): unknown => {
  if (typeof value !== "string") {
    throw new AppError("Product metadata is required", 400);
  }

  try {
    return JSON.parse(value);
  } catch {
    throw new AppError("Invalid product metadata", 400);
  }
};

const getUploadedFiles = (
  req: Request
): Express.Multer.File[] => {
  return (
    (req.files as Express.Multer.File[] | undefined) ?? []
  );
};


const parseProductId = (req: Request): number =>
  validated<ProductIdParam>(req, "params").id;


const logSettledFailures = (
  label: string,
  ids: string[],
  results: PromiseSettledResult<unknown>[]
) => {
  results.forEach((result, index) => {
    if (result.status === "rejected") {
      console.error(`${label} failed for ${ids[index]}:`, result.reason);
    }
  });
};


const isNewProductImage = (
  image: UpdateProductImage
): image is CreateProductImage => {
  return "fileIndex" in image;
};



const validateFileIndexes = (
  indexes: number[],
  filesLength: number
) => {
  const uniqueIndexes = new Set(indexes);


  if (uniqueIndexes.size !== indexes.length) {
    throw new AppError(
      "A file cannot be used more than once",
      400
    );
  }


  for (const index of indexes) {
    if (index < 0 || index >= filesLength) {
      throw new AppError("Invalid image file index", 400);
    }
  }


  if (uniqueIndexes.size !== filesLength) {
    throw new AppError(
      "Every uploaded image file must be referenced by the product metadata",
      400
    );
  }


  for (let index = 0; index < filesLength; index++) {
    if (!uniqueIndexes.has(index)) {
      throw new AppError(
        "Image file indexes must reference every uploaded file exactly once",
        400
      );
    }
  }
};



export const create = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const uploadedCloudinaryImages: { publicId: string }[] = [];

  try {


    const rawMetadata = parseMetadata(req.body.data);

    const validation = createProductSchema.safeParse(rawMetadata);

    if (!validation.success) {
      throw new AppError(
        validation.error.issues.map((issue) => issue.message).join(", "),
        400
      );
    }

    const data = validation.data;



    await validateCategory(data.categoryId);
    await validateProductUniqueness(data.name, data.slug);



    const files = getUploadedFiles(req);

    if (files.length === 0) {
      throw new AppError(
        "At least one product image is required",
        400
      );
    }


    const imageMetadata = data.colors.flatMap((color) => color.images);


    const usedFileIndexes = imageMetadata.map((image) => image.fileIndex);


    validateFileIndexes(usedFileIndexes, files.length);



    const uploadedImages = await uploadImagesToStorage(files);

    uploadedCloudinaryImages.push(
      ...uploadedImages.map((image) => ({ publicId: image.publicId }))
    );

    const productData: CreateProductInput = {
      name: data.name,
      slug: data.slug,
      description: data.description,
      details: data.details,
      categoryId: data.categoryId,
      isActive: data.isActive,

      colors: data.colors.map((color) => ({
        colorId: color.colorId,
        variants: color.variants,

        images: color.images.map((image) => {
          const uploaded = uploadedImages[image.fileIndex];

          if (!uploaded) {
            throw new AppError("Uploaded image not found", 400);
          }

          return {
            url: uploaded.url,
            publicId: uploaded.publicId,
            altText: image.altText,
            sortOrder: image.sortOrder,
            isPrimary: image.isPrimary,
          };
        }),
      })),
    };



    const product = await createProduct(productData);

    return res.status(201).json({
      success: true,
      message: "Product created successfully",
      data: product,
    });
  } catch (error) {


    if (uploadedCloudinaryImages.length > 0) {
      const ids = uploadedCloudinaryImages.map((i) => i.publicId);

      const results = await Promise.allSettled(
        ids.map((publicId) => deleteImageFromStorage(publicId))
      );

      logSettledFailures("Cloudinary cleanup (create)", ids, results);
    }

    next(error);
  }
};



export const list = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const query =
      validated<ListProductsQuery>(
        req,
        "query"
      );

    const { products, pagination } =
      await listProducts(query);

    return res.status(200).json({
      success: true,
      data: products,
      pagination,
    });
  } catch (error) {
    next(error);
  }
};



export const getById = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const id = parseProductId(req);

    const product = await getProductById(id);

    return res.status(200).json({
      success: true,
      data: product,
    });
  } catch (error) {
    next(error);
  }
};


export const update = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const newlyUploadedImages: { publicId: string }[] = [];

  try {
    const id = parseProductId(req);



    const rawMetadata = parseMetadata(req.body.data);



    const validation = updateProductSchema.safeParse(rawMetadata);

    if (!validation.success) {
      throw new AppError(
        validation.error.issues.map((issue) => issue.message).join(", "),
        400
      );
    }

    const data = validation.data;


    if (data.categoryId !== undefined) {
      await validateCategory(data.categoryId);
    }

    await validateProductUniqueness(data.name, data.slug, id);



    const files = getUploadedFiles(req);



    const hasColorChanges =
      data.colors !== undefined ||
      (data.removedColorIds !== undefined &&
        data.removedColorIds.length > 0);

    if (!hasColorChanges) {
      if (files.length > 0) {
        throw new AppError(
          "Images were uploaded but no product colors were provided",
          400
        );
      }

      const basicProductData: UpdateProductInput = {
        name: data.name,
        slug: data.slug,
        description: data.description,
        details: data.details,
        categoryId: data.categoryId,
        isActive: data.isActive,
      };

      const product = await updateProduct(id, basicProductData);

      return res.status(200).json({
        success: true,
        message: "Product updated successfully",
        data: product,
      });
    }



    const newImages = (data.colors ?? []).flatMap((color) =>
      color.images.filter(isNewProductImage)
    );



    if (newImages.length === 0 && files.length > 0) {
      throw new AppError(
        "Files were uploaded but no new product images were provided",
        400
      );
    }

    if (newImages.length > 0 && files.length === 0) {
      throw new AppError(
        "New product images were provided but no files were uploaded",
        400
      );
    }


    if (newImages.length > 0) {
      const newFileIndexes = newImages.map((image) => image.fileIndex);

      validateFileIndexes(newFileIndexes, files.length);
    }



    const uploadedImages =
      files.length > 0 ? await uploadImagesToStorage(files) : [];

    newlyUploadedImages.push(
      ...uploadedImages.map((image) => ({ publicId: image.publicId }))
    );



    const productData: UpdateProductInput = {
      name: data.name,
      slug: data.slug,
      description: data.description,
      details: data.details,
      categoryId: data.categoryId,
      isActive: data.isActive,
      removedColorIds: data.removedColorIds,

      colors: data.colors?.map((color) => ({
        colorId: color.colorId,
        variants: color.variants,

        images: color.images.map((image) => {


          if (!isNewProductImage(image)) {
            return {
              existing: true as const,
              id: image.id,
              altText: image.altText,
              sortOrder: image.sortOrder,
              isPrimary: image.isPrimary,
            };
          }



          const uploaded = uploadedImages[image.fileIndex];

          if (!uploaded) {
            throw new AppError("Uploaded image not found", 400);
          }

          return {
            url: uploaded.url,
            publicId: uploaded.publicId,
            altText: image.altText,
            sortOrder: image.sortOrder,
            isPrimary: image.isPrimary,
          };
        }),
      })),
    };



    const product = await updateProduct(id, productData);

    return res.status(200).json({
      success: true,
      message: "Product updated successfully",
      data: product,
    });
  } catch (error) {


    if (newlyUploadedImages.length > 0) {
      const ids = newlyUploadedImages.map((i) => i.publicId);

      const results = await Promise.allSettled(
        ids.map((publicId) => deleteImageFromStorage(publicId))
      );

      logSettledFailures("Cloudinary cleanup (update)", ids, results);
    }

    next(error);
  }
};



export const remove = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const id = parseProductId(req);

    await deleteProduct(id);

    return res.status(200).json({
      success: true,
      message: "Product deleted successfully",
    });
  } catch (error) {
    next(error);
  }
};
