const { TableClient, odata } = require("@azure/data-tables");
const ConfigurationService = require("../services/ConfigurationService");

const TABLE_NAME = "StripeEvents";
const PARTITION_KEY = "stripe";
const PROCESSING_TIMEOUT_MS = 10 * 60 * 1000;

const defaultDependencies = {
  TableClient,
  odata,
  ConfigurationService,
  now: function now() {
    return new Date();
  }
};

function createStorageError(message, error, fallbackCode) {
  const wrappedError = new Error(message);
  wrappedError.statusCode = error && error.statusCode ? error.statusCode : 503;
  wrappedError.code = error && error.code ? error.code : (fallbackCode || "StorageError");
  return wrappedError;
}

function createEventRepository(customDependencies) {
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

        const client = dependencies.TableClient.fromConnectionString(connectionString, TABLE_NAME);

        try {
          await client.createTable();
        } catch (error) {
          if (!error || error.statusCode !== 409) {
            throw createStorageError("Unable to initialize Stripe events table", error, "StorageInitializationFailed");
          }
        }

        return client;
      })();
    }

    return clientPromise;
  }

  async function getEvent(client, eventId) {
    const filter = dependencies.odata`PartitionKey eq ${PARTITION_KEY} and RowKey eq ${eventId}`;

    for await (const entity of client.listEntities({ queryOptions: { filter: filter } })) {
      return entity;
    }

    return null;
  }

  async function claimEvent(event) {
    const eventId = String((event && event.id) || "").trim();

    if (!eventId) {
      return { claimed: true, duplicate: false };
    }

    const client = await getClient();
    const now = dependencies.now();
    const entity = {
      partitionKey: PARTITION_KEY,
      rowKey: eventId,
      EventType: String((event && event.type) || ""),
      Status: "Processing",
      ReceivedAt: now.toISOString(),
      UpdatedAt: now.toISOString()
    };

    try {
      await client.createEntity(entity);
      return { claimed: true, duplicate: false };
    } catch (error) {
      if (!error || error.statusCode !== 409) {
        throw createStorageError("Unable to claim Stripe event", error, "StorageWriteFailed");
      }
    }

    const existing = await getEvent(client, eventId);

    if (!existing) {
      throw createStorageError("Unable to load existing Stripe event claim", null, "StorageReadFailed");
    }

    if (existing.Status === "Processed") {
      return { claimed: false, duplicate: true, status: existing.Status };
    }

    const updatedAt = new Date(existing.UpdatedAt || existing.ReceivedAt || 0).getTime();
    if (existing.Status === "Processing" && Number.isFinite(updatedAt)
      && now.getTime() - updatedAt < PROCESSING_TIMEOUT_MS) {
      return { claimed: false, duplicate: true, status: existing.Status };
    }

    try {
      await client.updateEntity({
        partitionKey: PARTITION_KEY,
        rowKey: eventId,
        EventType: entity.EventType,
        Status: "Processing",
        UpdatedAt: now.toISOString()
      }, "Merge", existing.etag ? { etag: existing.etag } : undefined);
      return { claimed: true, duplicate: false, status: "Processing" };
    } catch (updateError) {
      if (updateError && updateError.statusCode === 412) {
        return { claimed: false, duplicate: true, status: "Processing" };
      }

      throw createStorageError("Unable to reclaim Stripe event", updateError, "StorageUpdateFailed");
    }
  }

  async function markEvent(eventId, status, details) {
    const normalizedId = String(eventId || "").trim();
    if (!normalizedId) {
      return;
    }

    const client = await getClient();
    const existing = await getEvent(client, normalizedId);
    if (!existing) {
      return;
    }

    const now = dependencies.now();
    const entity = {
      partitionKey: PARTITION_KEY,
      rowKey: normalizedId,
      Status: status,
      UpdatedAt: now.toISOString()
    };

    if (details && details.error) {
      entity.Error = String(details.error).slice(0, 1000);
    }

    try {
      await client.updateEntity(
        entity,
        "Merge",
        existing.etag ? { etag: existing.etag } : undefined
      );
    } catch (error) {
      if (error && error.statusCode === 412) {
        throw createStorageError("Stripe event changed before it could be marked", error, "StorageConflict");
      }
      throw createStorageError("Unable to mark Stripe event", error, "StorageUpdateFailed");
    }
  }

  return { claimEvent, markEvent };
}

let activeRepository = createEventRepository();

function __setDependencies(overrides) {
  activeRepository = createEventRepository(overrides);
}

function __resetDependencies() {
  activeRepository = createEventRepository();
}

module.exports = {
  claimEvent: function claimEventProxy(event) {
    return activeRepository.claimEvent(event);
  },
  markEvent: function markEventProxy(eventId, status, details) {
    return activeRepository.markEvent(eventId, status, details);
  },
  createEventRepository,
  __setDependencies,
  __resetDependencies
};
