const { TableClient } = require("@azure/data-tables");
const { v4: uuidv4 } = require("uuid");
const ConfigurationService = require("../services/ConfigurationService");

const TABLE_NAME = "InventoryLeases";
const PARTITION_KEY = "global";
const ROW_KEY = "reservation-inventory";
const DEFAULT_TTL_MS = 30000;

const defaultDependencies = {
  TableClient,
  uuidv4,
  ConfigurationService,
  now: function now() {
    return new Date();
  }
};

function createError(message, statusCode, code) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function createRepository(customDependencies) {
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
          throw createError("Storage is not configured", 503, "StorageNotConfigured");
        }

        const client = dependencies.TableClient.fromConnectionString(connectionString, TABLE_NAME);
        try {
          await client.createTable();
        } catch (error) {
          if (!error || error.statusCode !== 409) {
            throw error;
          }
        }
        return client;
      })();
    }
    return clientPromise;
  }

  async function acquireLease(owner, ttlMs) {
    const client = await getClient();
    const now = dependencies.now();
    const leaseId = dependencies.uuidv4();
    const expiresAt = new Date(now.getTime() + (Number(ttlMs) > 0 ? Number(ttlMs) : DEFAULT_TTL_MS));
    let existing = null;

    try {
      existing = await client.getEntity(PARTITION_KEY, ROW_KEY);
    } catch (error) {
      if (!error || error.statusCode !== 404) {
        throw error;
      }
    }

    if (existing && new Date(existing.ExpiresAt || 0).getTime() > now.getTime()) {
      throw createError("Inventory is busy; retry the reservation", 409, "InventoryBusy");
    }

    const entity = {
      partitionKey: PARTITION_KEY,
      rowKey: ROW_KEY,
      LeaseId: leaseId,
      Owner: String(owner || "unknown"),
      AcquiredAt: now.toISOString(),
      ExpiresAt: expiresAt.toISOString()
    };

    try {
      if (existing) {
        const update = await client.updateEntity(
          entity,
          "Merge",
          existing.etag ? { etag: existing.etag } : undefined
        );
        return { leaseId, etag: (update && update.etag) || existing.etag || "", expiresAt: expiresAt.toISOString() };
      }

      const created = await client.createEntity(entity);
      return {
        leaseId,
        etag: (created && created.etag) || "",
        expiresAt: expiresAt.toISOString()
      };
    } catch (error) {
      if (error && (error.statusCode === 409 || error.statusCode === 412)) {
        throw createError("Inventory is busy; retry the reservation", 409, "InventoryBusy");
      }
      throw error;
    }
  }

  async function releaseLease(lease) {
    if (!lease || !lease.leaseId) {
      return;
    }

    const client = await getClient();
    const entity = {
      partitionKey: PARTITION_KEY,
      rowKey: ROW_KEY,
      LeaseId: "",
      Owner: "",
      ExpiresAt: new Date(0).toISOString()
    };

    try {
      await client.updateEntity(
        entity,
        "Merge",
        lease.etag ? { etag: lease.etag } : undefined
      );
    } catch (error) {
      if (error && error.statusCode === 412) {
        return;
      }
      throw error;
    }
  }

  return { acquireLease, releaseLease };
}

let activeRepository = createRepository();

function __setDependencies(overrides) {
  activeRepository = createRepository(overrides);
}

function __resetDependencies() {
  activeRepository = createRepository();
}

module.exports = {
  acquireLease: function acquireLeaseProxy(owner, ttlMs) {
    return activeRepository.acquireLease(owner, ttlMs);
  },
  releaseLease: function releaseLeaseProxy(lease) {
    return activeRepository.releaseLease(lease);
  },
  createRepository,
  __setDependencies,
  __resetDependencies
};
