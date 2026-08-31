const { TableClient } = require("@azure/data-tables");
const crypto = require("crypto");
const ConfigurationService = require("../services/ConfigurationService");

const TABLE_NAME = "MarketingContacts";

const defaultDependencies = {
  TableClient,
  ConfigurationService
};

function createStorageError(message, error, fallbackCode) {
  const wrappedError = new Error(message);
  wrappedError.statusCode = error && error.statusCode ? error.statusCode : 503;
  wrappedError.code = error && error.code ? error.code : fallbackCode;
  wrappedError.details = error && error.message ? error.message : undefined;
  return wrappedError;
}

function contactKey(email) {
  return crypto.createHash("sha256").update(email, "utf8").digest("hex");
}

function createMarketingContactRepository(customDependencies) {
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
            throw createStorageError(
              "Unable to initialize marketing contacts table",
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

  async function upsertContact(contact) {
    const email = String(contact && contact.email || "").trim().toLowerCase();
    const key = contactKey(email);
    const client = await getClient();
    const entity = {
      partitionKey: key.slice(0, 2),
      rowKey: key,
      Email: email,
      Status: "Subscribed",
      ConsentRecordedAt: contact.consentRecordedAt || new Date().toISOString(),
      ConsentSource: "Reservation",
      ConsentIp: String(contact.consentIp || "").slice(0, 128),
      ConsentUserAgent: String(contact.consentUserAgent || "").slice(0, 512),
      FirstName: String(contact.firstName || "").slice(0, 60),
      LastName: String(contact.lastName || "").slice(0, 60),
      LastReservationId: String(contact.reservationId || "").slice(0, 128)
    };

    try {
      await client.upsertEntity(entity, "Merge");
      return {
        email: entity.Email,
        status: entity.Status,
        consentRecordedAt: entity.ConsentRecordedAt
      };
    } catch (error) {
      throw createStorageError("Unable to save marketing contact", error, "StorageWriteFailed");
    }
  }

  return { upsertContact };
}

let activeRepository = createMarketingContactRepository();

function __setDependencies(overrides) {
  activeRepository = createMarketingContactRepository(overrides);
}

function __resetDependencies() {
  activeRepository = createMarketingContactRepository();
}

module.exports = {
  upsertContact: function upsertContactProxy(contact) {
    return activeRepository.upsertContact(contact);
  },
  __setDependencies,
  __resetDependencies
};