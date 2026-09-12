import redis, { connectRedis } from "../config/redis";

export const CATALOG_NAMESPACE = "catalog";

export const CATALOG_TTL_SECONDS = 300;

const VERSION_KEY_PREFIX = "cache:version:";

const ENTRY_KEY_PREFIX = "cache:entry:";

const versionKey = (namespace: string) =>
  `${VERSION_KEY_PREFIX}${namespace}`;

const readyClient = async () => {
  await connectRedis();

  return redis;
};

const readNamespaceVersion = async (
  namespace: string
): Promise<string> => {
  const client = await readyClient();

  const version = await client.get(
    versionKey(namespace)
  );

  if (version) {
    return version;
  }

  await client.set(versionKey(namespace), "1", {
    NX: true,
  });

  return (
    (await client.get(versionKey(namespace))) ?? "1"
  );
};

export const invalidateNamespace = async (
  namespace: string
): Promise<void> => {
  try {
    const client = await readyClient();

    await client.incr(versionKey(namespace));
  } catch (error) {
    console.error(
      `[cache] failed to invalidate namespace "${namespace}"`,
      error
    );
  }
};

export const cached = async <T>(
  namespace: string,
  key: string,
  ttlSeconds: number,
  load: () => Promise<T>
): Promise<T> => {
  const lookup = await (async () => {
    try {
      const client = await readyClient();

      const version = await readNamespaceVersion(
        namespace
      );

      const entryKey = `${ENTRY_KEY_PREFIX}${namespace}:${version}:${key}`;

      const hit = await client.get(entryKey);

      return {
        entryKey,
        value:
          hit === null
            ? null
            : (JSON.parse(hit) as T),
      };
    } catch (error) {
      console.error(
        `[cache] read failed for "${namespace}:${key}"`,
        error
      );

      return null;
    }
  })();

  if (lookup?.value != null) {
    return lookup.value;
  }

  const value = await load();

  if (lookup && value != null) {
    try {
      const client = await readyClient();

      await client.set(
        lookup.entryKey,
        JSON.stringify(value),
        {
          EX: ttlSeconds,
        }
      );
    } catch (error) {
      console.error(
        `[cache] write failed for "${namespace}:${key}"`,
        error
      );
    }
  }

  return value;
};

export const cacheDelete = async (
  key: string
): Promise<void> => {
  try {
    const client = await readyClient();

    await client.del(`${ENTRY_KEY_PREFIX}${key}`);
  } catch (error) {
    console.error(
      `[cache] delete failed for "${key}"`,
      error
    );
  }
};

export const cacheReadRaw = async <T>(
  key: string
): Promise<T | null> => {
  try {
    const client = await readyClient();

    const hit = await client.get(
      `${ENTRY_KEY_PREFIX}${key}`
    );

    return hit === null
      ? null
      : (JSON.parse(hit) as T);
  } catch (error) {
    console.error(
      `[cache] read failed for "${key}"`,
      error
    );

    return null;
  }
};

export const cacheWriteRaw = async (
  key: string,
  value: unknown,
  ttlSeconds: number
): Promise<void> => {
  try {
    const client = await readyClient();

    await client.set(
      `${ENTRY_KEY_PREFIX}${key}`,
      JSON.stringify(value),
      {
        EX: ttlSeconds,
      }
    );
  } catch (error) {
    console.error(
      `[cache] write failed for "${key}"`,
      error
    );
  }
};
