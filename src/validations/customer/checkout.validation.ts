import { z } from "zod";

export const checkoutSchema = z.object({
  addressId: z
    .number({
      error: "Select a delivery address",
    })
    .int()
    .positive("Select a delivery address"),

  paymentMethod: z.enum(["COD", "ONLINE"], {
    error: "Select a payment method",
  }),

  contactEmail: z
    .string()
    .trim()
    .toLowerCase()
    .email("Invalid email address")
    .max(254, "Email is too long"),

  contactPhone: z
    .string()
    .trim()
    .regex(
      /^\+?[1-9]\d{9,14}$/,
      "Invalid phone number"
    ),

  idempotencyKey: z
    .string()
    .uuid("idempotencyKey must be a valid UUID"),
});

export type CheckoutFormData = z.infer<typeof checkoutSchema>;

export const verifyPaymentSchema = z.object({
  razorpay_order_id: z.string().min(1, "Missing razorpay_order_id"),
  razorpay_payment_id: z.string().min(1, "Missing razorpay_payment_id"),
  razorpay_signature: z.string().min(1, "Missing razorpay_signature"),
});

export type VerifyPaymentFormData = z.infer<typeof verifyPaymentSchema>;