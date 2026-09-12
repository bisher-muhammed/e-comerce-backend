const DEFAULT_ORIGINS = ["http://localhost:3000"];

export const resolveAllowedOrigins = (
  raw: string | undefined
): string[] => {
  if (!raw) {
    return DEFAULT_ORIGINS;
  }

  const origins = raw
    .split(",")
    .map((origin) => origin.trim().replace(/\/+$/, ""))
    .filter((origin) => origin.length > 0);

  return origins.length > 0 ? origins : DEFAULT_ORIGINS;
};

export const isOriginAllowed = (
  origin: string | undefined,
  allowedOrigins: string[]
): boolean => {
  if (!origin) {
    return true;
  }

  return allowedOrigins.includes(
    origin.replace(/\/+$/, "")
  );
};
