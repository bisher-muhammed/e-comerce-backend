import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: Number(process.env.EMAIL_PORT) || 587,
  secure: false, // true for port 465, false for 587
  auth: {
    user: process.env.EMAIL_HOST_USER,
    pass: process.env.EMAIL_HOST_PASSWORD,
  },

  pool: true,
  maxConnections: Number(process.env.EMAIL_MAX_CONNECTIONS) || 3,
  maxMessages: Number(process.env.EMAIL_MAX_MESSAGES) || 100,

  connectionTimeout: 10_000,
  greetingTimeout: 10_000,
  socketTimeout: 20_000,
});

export const sendOtpEmail = async (
  email: string,
  otp: string
): Promise<void> => {
  try {
    await transporter.sendMail({
      from: `"STORE." <${process.env.EMAIL_FROM}>`,
      to: email,
      subject: "Your verification code",
      html: `
        <div style="
          font-family: Arial, sans-serif;
          max-width: 500px;
          margin: auto;
          padding: 24px;
        ">
          <h2>Verify your email</h2>

          <p>Your verification code is:</p>

          <div style="
            font-size: 32px;
            font-weight: bold;
            letter-spacing: 8px;
            margin: 20px 0;
          ">
            ${otp}
          </div>

          <p>This code will expire in 2 minutes.</p>

          <p>
            If you didn't request this code, you can safely ignore this email.
          </p>
        </div>
      `,
    });
  } catch (error) {
    console.error("Email service error:", error);

    throw new Error("Unable to send verification email");
  }
};

export const closeEmailTransport = async (): Promise<void> => {
  transporter.close();
};
