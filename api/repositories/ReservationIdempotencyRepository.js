const { TableClient } = require("@azure/data-tables");
const crypto = require("crypto");
const ConfigurationService = require("../services/ConfigurationService");

const TABLE_NAME = "ReservationIdempotency";
const PARTITION_KEY = "Reservation";
const DEFAULT_RETENTION_MS = 24 * 60 * 60 * 1000;

const defaultDependencies = {
  TableClient,
  ConfigurationService,
  now: function now() {
    return new Date();
  }
};

function createStorageError(message, error, fallbackCode) {
  const wrappedError = new Error(message);
  wrappedError.statusCode = error && error.statusCode ? error.statusCode : 503;
  wrappedError.code = error && error.code ? error.code : (fallbackCode || "StorageError");
  wrappedError.details = error && error.message ? error.message : undefined;
  return wrappedError;
}

function createIdempotencyError(message, code) {
  const error = new Error(message);
  error.statusCode = 409;
  error.code = code;
  return error;
}

function keyHash(key) {
  return crypto.createHash("sha256").update(String(key), "utf8").digest("hex");
}

function getEntityKey(key) {
  return {
    partitionKey: PARTITION_KEY,
    rowKey: keyHash(key)
  };
}

function entityEtag(entity) {
  return entity && (entity.etag || entity.ETag || "");
}

function parseStoredResponse(entity) {
  try {
    return JSON.parse(entity.ResponseJson || "");
  } catch (_error) {
    throw createStorageError(
      "Unable to read stored idempotency response",
      null,
      "IdempotencyResponseInvalid"
    );
  }
}

function createReservationIdempotencyRepository(customDependencies) {
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
          const error = new Error("Storage is not configured");
          error.statusCode = 503;
          error.code = "StorageNotConfigured";
          throw error;
        }

        const tableClient = dependencies.TableClient.fromConnectionString(connectionString, TABLE_NAME);

        try {
          await tableClient.createTable();
        } catch (error) {
          if (!error || error.statusCode !== 409) {
            throw createStorageError(
              "Unable to initialize reservation idempotency table",
              error,
              "StorageInitializationFailed"
            );
          }
        }

        return tableClient;
      })();
    }

    return clientPromise;
  }

  async function getEntity(key) {
    const client = await getClient();
    const entityKey = getEntityKey(key);

    try {
      return await client.getEntity(entityKey.partitionKey, entityKey.rowKey);
    } catch (error) {
      if (error && error.statusCode === 404) {
        return null;
      }

      throw createStorageError("Unable to load reservation idempotency record", error, "StorageReadFailed");
    }
  }

  async function claimRequest(key, fingerprint, now) {
    const client = await getClient();
    const entityKey = getEntityKey(key);
    const createdAt = (now instanceof Date ? now : new Date(now || dependencies.now())).toISOString();
    const entity = {
      ...entityKey,
      Fingerprint: String(fingerprint || ""),
      Status: "Processing",
      CreatedAt: createdAt,
      UpdatedAt: createdAt,
      ExpiresAt: new Date(new Date(createdAt).getTime() + DEFAULT_RETENTION_MS).toISOString(),
      ResponseJson: ""
    };

    try {
      await client.createEntity(entity);
      return {
        claimed: true,
        etag: ""
      };
    } catch (error) {
      if (!error || error.statusCode !== 409) {
        throw createStorageError("Unable to claim reservation idempotency key", error, "StorageWriteFailed");
      }
    }

    const existing = await getEntity(key);

    if (!existing) {
      throw createStorageError(
        "Unable to read reservation idempotency key after conflict",
        null,
        "IdempotencyClaimRace"
      );
    }

    if (String(existing.Fingerprint || "") !== String(fingerprint || "")) {
      throw createIdempotencyError(
        "Idempotency-Key was already used for a different reservation",
        "IdempotencyKeyReuse"
      );
    }

    if (existing.Status === "Completed") {
      return {
        completed: true,
        response: parseStoredResponse(existing),
        etag: entityEtag(existing)
      };
    }

    if (existing.Status === "Failed") {
      throw createIdempotencyError(
        "The previous reservation request failed; use a new Idempotency-Key",
        "IdempotencyRequestFailed"
      );
    }

    throw createIdempotencyError(
      "A reservation request with this Idempotency-Key is still processing",
      "IdempotencyRequestInProgress"
    );
  }

  async function completeRequest(key, response, options) {
    const client = await getClient();
    const entityKey = getEntityKey(key);
    const existing = await getEntity(key);

    if (!existing) {
      throw createStorageError("Reservation idempotency record was not found", null, "IdempotencyRecordNotFound");
    }

    const entity = {
      ...entityKey,
      Status: "Completed",
      UpdatedAt: new Date().toISOString(),
      ResponseJson: JSON.stringify(response)
    };
    const etag = (options && options.expectedEtag) || entityEtag(existing);

    try {
      const updateResult = etag
        ? await client.updateEntity(entity, "Merge", { etag: etag })
        : await client.updateEntity(entity, "Merge");

      return {
        completed: true,
        etag: (updateResult && updateResult.etag) || etag || ""
      };
    } catch (error) {
      if (error && error.statusCode === 412) {
        throw createIdempotencyError("Reservation idempotency record changed during completion", "IdempotencyConflict");
      }

      throw createStorageError("Unable to complete reservation idempotency record", error, "StorageUpdateFailed");
    }
  }

  async function failRequest(key, errorValue) {
    const client = await getClient();
    const entityKey = getEntityKey(key);
    const existing = await getEntity(key);

    if (!existing || existing.Status === "Completed") {
      return null;
    }

    const entity = {
      ...entityKey,
      Status: "Failed",
      UpdatedAt: new Date().toISOString(),
      ErrorCode: String((errorValue && errorValue.code) || "ReservationFailed")
    };
    const etag = entityEtag(existing);

    try {
      const updateResult = etag
        ? await client.updateEntity(entity, "Merge", { etag: etag })
        : await client.updateEntity(entity, "Merge");

      return {
        failed: true,
        etag: (updateResult && updateResult.etag) || etag || ""
      };
    } catch (updateError) {
      throw createStorageError("Unable to mark reservation idempotency request as failed", updateError, "StorageUpdateFailed");
    }
  }

  return {
    claimRequest,
    completeRequest,
    failRequest
  };
}

let activeRepository = createReservationIdempotencyRepository();

function __setDependencies(overrides) {
  activeRepository = createReservationIdempotencyRepository(overrides);
}

function __resetDependencies() {
  activeRepository = createReservationIdempotencyRepository();
}

module.exports = {
  claimRequest: function claimRequestProxy(key, fingerprint, now) {
    return activeRepository.claimRequest(key, fingerprint, now);
  },
  completeRequest: function completeRequestProxy(key, response, options) {
    return activeRepository.completeRequest(key, response, options);
  },
  failRequest: function failRequestProxy(key, error) {
    return activeRepository.failRequest(key, error);
  },
  createReservationIdempotencyRepository,
  __setDependencies,
  __resetDependencies
};