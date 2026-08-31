const { TableClient } = require("@azure/data-tables");
const ConfigurationService = require("../services/ConfigurationService");

const TABLE_NAME = "AbuseProtection";
const MAX_UPDATE_ATTEMPTS = 6;
const RETENTION_MS = 24 * 60 * 60 * 1000;

const defaultDependencies = {
  TableClient,
  ConfigurationService,
  now: function now() {
    return new Date();
  }
};

function repositoryError(message, error, fallbackCode) {
  const wrapped = new Error(message);
  wrapped.statusCode = error && error.statusCode ? error.statusCode : 503;
  wrapped.code = error && error.code ? error.code : fallbackCode;
  return wrapped;
}

function createRateLimitRepository(customDependencies) {
  const dependencies = {
    ...defaultDependencies,
    ...(customDependencies || {})
  };
  let clientPromise = null;

  async function getClient() {
    if (!clientPromise) {
      clientPromise = (async function initializeClient() {
        const connectionString = dependencies.ConfigurationService.getStorageConnectionString();
        if (!connectionString) {
          throw repositoryError("Rate-limit storage is not configured", null, "RateLimitStorageNotConfigured");
        }

        const client = dependencies.TableClient.fromConnectionString(connectionString, TABLE_NAME);
        try {
          await client.createTable();
        } catch (error) {
          if (!error || error.statusCode !== 409) {
            throw repositoryError("Unable to initialize rate-limit storage", error, "RateLimitStorageFailed");
          }
        }
        return client;
      })();
    }
    return clientPromise;
  }

  async function readEntity(client, partitionKey, rowKey) {
    try {
      return await client.getEntity(partitionKey, rowKey);
    } catch (error) {
      if (error && error.statusCode === 404) {
        return null;
      }
      throw repositoryError("Unable to read rate-limit state", error, "RateLimitStorageFailed");
    }
  }

  async function consume(policyKey, subjectHash, limit, windowSeconds) {
    const normalizedLimit = Number(limit);
    const normalizedWindowSeconds = Number(windowSeconds);
    if (!/^[a-z0-9-]{1,64}$/.test(String(policyKey || ""))
      || !/^[a-f0-9]{64}$/.test(String(subjectHash || ""))
      || !Number.isInteger(normalizedLimit) || normalizedLimit < 1
      || !Number.isInteger(normalizedWindowSeconds) || normalizedWindowSeconds < 1) {
      throw repositoryError("Rate-limit policy is invalid", null, "RateLimitPolicyInvalid");
    }

    const client = await getClient();
    const now = dependencies.now();
    const windowMs = normalizedWindowSeconds * 1000;
    const bucketStart = Math.floor(now.getTime() / windowMs) * windowMs;
    const resetAt = new Date(bucketStart + windowMs);
    const partitionKey = String(policyKey);
    const rowKey = String(subjectHash);
    const windowStartedAt = new Date(bucketStart).toISOString();

    for (let attempt = 0; attempt < MAX_UPDATE_ATTEMPTS; attempt += 1) {
      const existing = await readEntity(client, partitionKey, rowKey);

      if (!existing) {
        try {
          await client.createEntity({
            partitionKey,
            rowKey,
            Count: 1,
            WindowStartedAt: windowStartedAt,
            ResetAt: resetAt.toISOString(),
            ExpiresAt: new Date(resetAt.getTime() + RETENTION_MS).toISOString()
          });
          return { allowed: true, remaining: normalizedLimit - 1, resetAt: resetAt.toISOString() };
        } catch (error) {
          if (error && error.statusCode === 409) {
            continue;
          }
          throw repositoryError("Unable to create rate-limit state", error, "RateLimitStorageFailed");
        }
      }

      if (existing.WindowStartedAt !== windowStartedAt) {
        try {
          await client.updateEntity({
            partitionKey,
            rowKey,
            Count: 1,
            WindowStartedAt: windowStartedAt,
            ResetAt: resetAt.toISOString(),
            ExpiresAt: new Date(resetAt.getTime() + RETENTION_MS).toISOString()
          }, "Merge", existing.etag ? { etag: existing.etag } : undefined);
          return { allowed: true, remaining: normalizedLimit - 1, resetAt: resetAt.toISOString() };
        } catch (error) {
          if (error && error.statusCode === 412) {
            continue;
          }
          throw repositoryError("Unable to reset rate-limit state", error, "RateLimitStorageFailed");
        }
      }

      const count = Number(existing.Count || 0);
      if (count >= normalizedLimit) {
        return { allowed: false, remaining: 0, resetAt: resetAt.toISOString() };
      }

      try {
        await client.updateEntity({
          partitionKey,
          rowKey,
          Count: count + 1,
          ExpiresAt: new Date(resetAt.getTime() + RETENTION_MS).toISOString()
        }, "Merge", existing.etag ? { etag: existing.etag } : undefined);
        return {
          allowed: true,
          remaining: Math.max(0, normalizedLimit - count - 1),
          resetAt: resetAt.toISOString()
        };
      } catch (error) {
        if (error && error.statusCode === 412) {
          continue;
        }
        throw repositoryError("Unable to update rate-limit state", error, "RateLimitStorageFailed");
      }
    }

    throw repositoryError("Rate-limit state is busy", null, "RateLimitStorageConflict");
  }

  return { consume };
}

let activeRepository = createRateLimitRepository();

module.exports = {
  consume: function consumeProxy(policyKey, subjectHash, limit, windowSeconds) {
    return activeRepository.consume(policyKey, subjectHash, limit, windowSeconds);
  },
  createRateLimitRepository,
  __setDependencies: function __setDependencies(overrides) {
    activeRepository = createRateLimitRepository(overrides);
  },
  __resetDependencies: function __resetDependencies() {
    activeRepository = createRateLimitRepository();
  }
};