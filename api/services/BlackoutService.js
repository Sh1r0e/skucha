const BlackoutRepository = require("../repositories/BlackoutRepository");
const ConfigurationService = require("./ConfigurationService");
const InventoryLeaseRepository = require("../repositories/InventoryLeaseRepository");
const TimeService = require("./ReservationTimeService");

const MAX_BLACKOUT_ID_LENGTH = 128;
const MAX_REASON_LENGTH = 200;

const defaultDependencies = {
  BlackoutRepository,
  ConfigurationService,
  InventoryLeaseRepository,
  TimeService
};

function badRequest(message, code) {
  const error = new Error(message);
  error.statusCode = 400;
  error.code = code || "BadRequest";
  return error;
}

function notFound(message, code) {
  const error = new Error(message);
  error.statusCode = 404;
  error.code = code || "NotFound";
  return error;
}

function normalizeDate(value, fieldName, timeService) {
  const normalized = String(value || "").trim();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw badRequest(fieldName + " must be in YYYY-MM-DD format", "InvalidDate");
  }

  try {
    timeService.parseDateOnlyAsUtc(normalized);
  } catch (_error) {
    throw badRequest(fieldName + " must be a valid calendar date", "InvalidDate");
  }

  return normalized;
}

function normalizeId(value) {
  const id = String(value || "").trim();

  if (!id || id.length > MAX_BLACKOUT_ID_LENGTH) {
    throw badRequest("id is required", "MissingId");
  }

  return id;
}

function createBlackoutService(customDependencies) {
  const dependencies = {
    ...defaultDependencies,
    ...(customDependencies || {})
  };

  function hasStorage() {
    return typeof dependencies.ConfigurationService.getStorageConnectionString === "function"
      && dependencies.ConfigurationService.getStorageConnectionString();
  }

  async function withInventoryLease(work) {
    if (!hasStorage()
      || !dependencies.InventoryLeaseRepository
      || typeof dependencies.InventoryLeaseRepository.acquireLease !== "function") {
      return work();
    }

    const lease = await dependencies.InventoryLeaseRepository.acquireLease("blackout-update", 30000);

    try {
      return await work();
    } finally {
      try {
        await dependencies.InventoryLeaseRepository.releaseLease(lease);
      } catch (_error) {
        void _error;
      }
    }
  }

  async function listBlackouts() {
    return dependencies.BlackoutRepository.getBlackouts();
  }

  async function createBlackout(payload) {
    const input = payload || {};
    const fromDate = normalizeDate(input.fromDate, "fromDate", dependencies.TimeService);
    const toDate = normalizeDate(input.toDate, "toDate", dependencies.TimeService);

    if (fromDate > toDate) {
      throw badRequest("toDate must be on or after fromDate", "InvalidDateRange");
    }

    const reason = String(input.reason || "").trim();
    if (reason.length > MAX_REASON_LENGTH) {
      throw badRequest("reason is too long", "ReasonTooLong");
    }

    return withInventoryLease(function () {
      return dependencies.BlackoutRepository.saveBlackout({
        fromDate,
        toDate,
        reason,
        createdBy: input.createdBy
      });
    });
  }

  async function deleteBlackout(value) {
    const id = normalizeId(value);
    const deleted = await withInventoryLease(function () {
      return dependencies.BlackoutRepository.deleteBlackout(id);
    });

    if (!deleted) {
      throw notFound("Blackout period not found", "NotFound");
    }

    return { id };
  }

  return {
    listBlackouts,
    createBlackout,
    deleteBlackout
  };
}

let activeService = createBlackoutService();

function __setDependencies(overrides) {
  activeService = createBlackoutService(overrides);
}

function __resetDependencies() {
  activeService = createBlackoutService();
}

module.exports = {
  listBlackouts: function listBlackoutsProxy() {
    return activeService.listBlackouts();
  },
  createBlackout: function createBlackoutProxy(payload) {
    return activeService.createBlackout(payload);
  },
  deleteBlackout: function deleteBlackoutProxy(id) {
    return activeService.deleteBlackout(id);
  },
  createBlackoutService,
  __setDependencies,
  __resetDependencies
};