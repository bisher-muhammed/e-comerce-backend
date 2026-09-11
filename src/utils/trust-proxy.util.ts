export const resolveTrustProxy = (
  raw: string | undefined
): boolean | number | string => {
  const value = raw?.trim();

  if (!value) {
    return false;
  }

  if (value === "false") {
    return false;
  }

  if (value === "true") {
    return true;
  }

  const hops = Number(value);

  if (Number.isInteger(hops) && hops >= 0) {
    return hops;
  }

  return value;
};
