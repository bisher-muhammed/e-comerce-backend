const DEFAULT_UTC_OFFSET_MINUTES = 330;

const DAY_MS = 24 * 60 * 60 * 1000;

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const resolveOffsetMinutes = (
  raw: string | undefined
): number => {
  const parsed = Number(raw);

  return Number.isFinite(parsed) &&
    Math.abs(parsed) <= 14 * 60
    ? parsed
    : DEFAULT_UTC_OFFSET_MINUTES;
};

const offsetMinutes = resolveOffsetMinutes(
  process.env.APP_UTC_OFFSET_MINUTES
);

export const isValidDateInput = (
  value: string
): boolean =>
  !Number.isNaN(new Date(value).getTime());

export const startOfBusinessDayUtc = (
  now: Date = new Date()
): Date => {
  const local = new Date(
    now.getTime() + offsetMinutes * 60 * 1000
  );

  return new Date(
    Date.UTC(
      local.getUTCFullYear(),
      local.getUTCMonth(),
      local.getUTCDate(),
      0,
      0,
      0,
      0
    )
  );
};

export const toDayBoundary = (
  value: string,
  edge: "start" | "end"
): Date => {
  const trimmed = value.trim();

  if (!DATE_ONLY_PATTERN.test(trimmed)) {
    return new Date(trimmed);
  }

  const [year, month, day] = trimmed
    .split("-")
    .map(Number);

  const localMidnightUtc =
    Date.UTC(year, month - 1, day) -
    offsetMinutes * 60 * 1000;

  return new Date(
    edge === "start"
      ? localMidnightUtc
      : localMidnightUtc + DAY_MS - 1
  );
};
