const { TableClient, odata } = require("@azure/data-tables");
const { v4: uuidv4 } = require("uuid");
const ConfigurationService = require("../services/ConfigurationService");

const TABLE_NAME = "Reservations";
const ALLOWED_STATUSES = ["Pending", "Confirmed", "Cancelled", "Completed"];

let clientPromise = null;

function createStorageError(message, error) {
  const wrappedError = new Error(message);
  wrappedError.statusCode = error && error.statusCode ? error.statusCode : 503;
  wrappedError.code = error && error.code ? error.code : "StorageError";
  return wrappedError;
}

function monthPartitionKey(dateValue) {
  const candidate = String(dateValue || "").slice(0, 7);
  return /^\d{4}-\d{2}$/.test(candidate)
    ? candidate
    : new Date().toISOString().slice(0, 7);
}

function normalizeStatus(status) {
  const normalized = String(status || "Pending");

  if (ALLOWED_STATUSES.indexOf(normalized) === -1) {
    const error = new Error("Invalid reservation status");
    error.statusCode = 400;
    throw error;
  }

  return normalized;
}

function toPublicReservation(entity) {
  if (!entity) {
    return null;
  }

  return {
    id: entity.rowKey,
    partitionKey: entity.partitionKey,
    createdAt: entity.CreatedAt,
    status: entity.Status,
    customerName: entity.CustomerName,
    customerEmail: entity.CustomerEmail,
    customerPhone: entity.CustomerPhone,
    fromDate: entity.FromDate,
    toDate: entity.ToDate,
    pads: Number(entity.Pads || 0),
    notes: entity.Notes || ""
  };
}

async function getClient() {
  if (!clientPromise) {
    clientPromise = (async function initializeClient() {
      const connectionString = ConfigurationService.getStorageConnectionString();

      if (!connectionString) {
        const configError = new Error("Storage is not configured");
        configError.statusCode = 503;
        configError.code = "StorageNotConfigured";
        throw configError;
      }

      const tableClient = TableClient.fromConnectionString(connectionString, TABLE_NAME);

      try {
        await tableClient.createTable();
      } catch (error) {
        if (error && error.statusCode !== 409) {
          throw createStorageError("Unable to initialize reservations table", error);
        }
      }

      return tableClient;
    })();
  }

  return clientPromise;
}

async function saveReservation(reservation) {
  const client = await getClient();
  const reservationId = uuidv4();
  const createdAt = new Date().toISOString();

  const entity = {
    partitionKey: monthPartitionKey(reservation.dateFrom || createdAt),
    rowKey: reservationId,
    CreatedAt: createdAt,
    Status: normalizeStatus(reservation.status),
    CustomerName: reservation.fullName,
    CustomerEmail: reservation.email,
    CustomerPhone: reservation.phone,
    FromDate: reservation.dateFrom,
    ToDate: reservation.dateTo,
    Pads: Number(reservation.padsCount || 0),
    Notes: reservation.notes || ""
  };

  try {
    await client.createEntity(entity);
    return toPublicReservation(entity);
  } catch (error) {
    throw createStorageError("Unable to save reservation", error);
  }
}

async function getReservation(id) {
  const client = await getClient();
  const filter = odata`RowKey eq ${id}`;

  try {
    for await (const entity of client.listEntities({ queryOptions: { filter } })) {
      return toPublicReservation(entity);
    }

    return null;
  } catch (error) {
    throw createStorageError("Unable to load reservation", error);
  }
}

async function getReservations() {
  const client = await getClient();

  try {
    const reservations = [];

    for await (const entity of client.listEntities()) {
      reservations.push(toPublicReservation(entity));
    }

    return reservations;
  } catch (error) {
    throw createStorageError("Unable to load reservations", error);
  }
}

async function updateStatus(id, status) {
  const client = await getClient();
  const existing = await getReservation(id);

  if (!existing) {
    return null;
  }

  const entity = {
    partitionKey: existing.partitionKey,
    rowKey: existing.id,
    Status: normalizeStatus(status)
  };

  try {
    await client.updateEntity(entity, "Merge");
    return {
      ...existing,
      status: entity.Status
    };
  } catch (error) {
    throw createStorageError("Unable to update reservation status", error);
  }
}

module.exports = {
  saveReservation,
  getReservation,
  getReservations,
  updateStatus
};
