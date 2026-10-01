const { TableClient } = require("@azure/data-tables");
const { randomUUID: uuidv4 } = require("crypto");
const ConfigurationService = require("../services/ConfigurationService");

const TABLE_NAME = "AvailabilityBlackouts";
const PARTITION_KEY = "blackout";

const defaultDependencies = {
  TableClient,
  uuidv4,
  ConfigurationService
};

function createStorageError(message, error, fallbackCode) {
  const wrappedError = new Error(message);
  wrappedError.statusCode = error && error.statusCode ? error.statusCode : 503;
  wrappedError.code = error && error.code ? error.code : (fallbackCode || "StorageError");
  wrappedError.details = error && error.message ? error.message : undefined;
  return wrappedError;
}

function toPublicBlackout(entity) {
  return {
    id: entity.rowKey,
    fromDate: entity.FromDate,
    toDate: entity.ToDate,
    reason: entity.Reason || "",
    createdAt: entity.CreatedAt || "",
    createdBy: entity.CreatedBy || ""
  };
}

function createBlackoutRepository(customDependencies) {
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
          const configError = new Error("Storage is not configured");
          configError.statusCode = 503;
          configError.code = "StorageNotConfigured";
          throw configError;
        }

        const tableClient = dependencies.TableClient.fromConnectionString(connectionString, TABLE_NAME);

        try {
          await tableClient.createTable();
        } catch (error) {
          if (error && error.statusCode !== 409) {
            throw createStorageError("Unable to initialize blackout table", error, "StorageInitializationFailed");
          }
        }

        return tableClient;
      })();
    }

    return clientPromise;
  }

  async function saveBlackout(blackout) {
    const client = await getClient();
    const entity = {
      partitionKey: PARTITION_KEY,
      rowKey: dependencies.uuidv4(),
      CreatedAt: new Date().toISOString(),
      CreatedBy: String(blackout.createdBy || "").trim(),
      FromDate: blackout.fromDate,
      ToDate: blackout.toDate,
      Reason: String(blackout.reason || "").trim()
    };

    try {
      await client.createEntity(entity);
      return toPublicBlackout(entity);
    } catch (error) {
      throw createStorageError("Unable to save blackout period", error, "StorageWriteFailed");
    }
  }

  async function getBlackouts() {
    const client = await getClient();

    try {
      const blackouts = [];

      for await (const entity of client.listEntities()) {
        blackouts.push(toPublicBlackout(entity));
      }

      return blackouts.sort(function (left, right) {
        return String(left.fromDate || "").localeCompare(String(right.fromDate || ""))
          || String(left.toDate || "").localeCompare(String(right.toDate || ""));
      });
    } catch (error) {
      throw createStorageError("Unable to load blackout periods", error, "StorageReadFailed");
    }
  }

  async function deleteBlackout(id) {
    const client = await getClient();
    let entity;

    try {
      entity = await client.getEntity(PARTITION_KEY, id);
    } catch (error) {
      if (error && error.statusCode === 404) {
        return false;
      }
      throw createStorageError("Unable to find blackout period", error, "StorageReadFailed");
    }

    try {
      await client.deleteEntity(
        PARTITION_KEY,
        id,
        entity.etag ? { etag: entity.etag } : undefined
      );
      return true;
    } catch (error) {
      if (error && error.statusCode === 404) {
        return false;
      }
      throw createStorageError("Unable to delete blackout period", error, "StorageDeleteFailed");
    }
  }

  return {
    saveBlackout,
    getBlackouts,
    deleteBlackout
  };
}

let activeRepository = createBlackoutRepository();

function __setDependencies(overrides) {
  activeRepository = createBlackoutRepository(overrides);
}

function __resetDependencies() {
  activeRepository = createBlackoutRepository();
}

module.exports = {
  saveBlackout: function saveBlackoutProxy(blackout) {
    return activeRepository.saveBlackout(blackout);
  },
  getBlackouts: function getBlackoutsProxy() {
    return activeRepository.getBlackouts();
  },
  deleteBlackout: function deleteBlackoutProxy(id) {
    return activeRepository.deleteBlackout(id);
  },
  createBlackoutRepository,
  __setDependencies,
  __resetDependencies
};