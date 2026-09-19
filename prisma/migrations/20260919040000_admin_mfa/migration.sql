-- M4: TOTP second factor for admin accounts.
ALTER TABLE "UserCredential" ADD COLUMN     "totpEnabledAt" TIMESTAMP(3),
ADD COLUMN     "totpSecret" TEXT;
