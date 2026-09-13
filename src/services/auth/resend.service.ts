import {
  getRegistrationSession,
  issueOtp,
  refundOtpResend,
  spendOtpResend,
} from "./otp.service";

export const resendRegistrationOtp = async (
  registrationToken: string
) => {
  // 1. Check registration session
  const registrationData =
    await getRegistrationSession(
      registrationToken,
      "Registration session has expired. Please register again."
    );

  // 2. Spend one resend from the session budget
  // Throws while the cooldown is open or once the budget is gone
  await spendOtpResend(registrationToken);

  // 3. Replace the previous OTP
  // New OTP gets a fresh 2-minute lifetime and a fresh guess budget
  try {
    await issueOtp(
      registrationToken,
      registrationData.email
    );
  } catch (error) {
    await refundOtpResend(registrationToken);

    throw error;
  }

  return {
    message: "A new verification code has been sent",
  };
};
