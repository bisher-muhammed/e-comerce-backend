const SENSITIVE_KEY =
  /otp|password|secret|token|authorization|api[-_]?key|cookie|credential/i;

const REDACTED = "[redacted]";

type LogContextValue =
  | string
  | number
  | boolean
  | null
  | undefined;

export type LogContext = Record<
  string,
  LogContextValue
>;

export type Scrubber = (text: string) => string;

const safeContext = (context: LogContext) =>
  Object.fromEntries(
    Object.entries(context).map(([key, value]) => [
      key,
      SENSITIVE_KEY.test(key) ? REDACTED : value,
    ])
  );

const asNamedMessage = (error: unknown) => {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  if (
    typeof error !== "object" ||
    error === null ||
    typeof (error as { message?: unknown }).message !==
      "string"
  ) {
    return undefined;
  }

  const shaped = error as {
    name?: unknown;
    message: string;
  };

  return {
    name:
      typeof shaped.name === "string"
        ? shaped.name
        : "UnknownError",
    message: shaped.message,
    stack: undefined,
  };
};

const describeError = (
  error: unknown,
  scrub?: Scrubber
) => {
  const described = asNamedMessage(error);

  if (!described) {
    return {
      name: "UnknownError",
      message: "Non-error value thrown",
    };
  }

  const apply = (text: string) =>
    scrub ? scrub(text) : text;

  const withStack =
    process.env.NODE_ENV !== "production" &&
    typeof described.stack === "string";

  return {
    name: described.name,
    message: apply(described.message),

    ...(withStack
      ? { stack: apply(described.stack as string) }
      : {}),
  };
};

type ErrorDetails = {
  name: string;
  message: string;
  stack?: string;
};

type SafeContext = Record<string, LogContextValue>;

const formatReadable = (
  level: "error" | "info",
  time: string,
  event: string,
  context?: SafeContext,
  error?: ErrorDetails
) => {
  const details = Object.entries(context ?? {})
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(" ");

  const head = [
    time.slice(11, 19),
    level === "error" ? "error" : "info ",
    event,
    details,
  ]
    .filter((part) => part.length > 0)
    .join("  ");

  if (!error) {
    return head;
  }

  if (error.stack) {
    return `${head}\n${error.stack}`;
  }

  return `${head}  ${error.name}: ${error.message}`;
};

const write = (
  level: "error" | "info",
  event: string,
  context?: LogContext,
  error?: ErrorDetails
) => {
  const time = new Date().toISOString();

  const safe = context
    ? safeContext(context)
    : undefined;

  const line =
    process.env.NODE_ENV === "production"
      ? JSON.stringify({
          level,
          time,
          event,
          ...(safe ? { context: safe } : {}),
          ...(error ? { error } : {}),
        })
      : formatReadable(
          level,
          time,
          event,
          safe,
          error
        );

  if (level === "error") {
    console.error(line);

    return;
  }

  console.log(line);
};

export const logError = (
  event: string,
  error: unknown,
  context?: LogContext,
  scrub?: Scrubber
) => {
  write(
    "error",
    event,
    context,
    describeError(error, scrub)
  );
};

export const logInfo = (
  event: string,
  context?: LogContext
) => {
  write("info", event, context);
};
