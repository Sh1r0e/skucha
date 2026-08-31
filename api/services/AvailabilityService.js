const ConfigService = require("./ConfigService");
const ReservationRepository = require("../repositories/ReservationRepository");
const ConfigurationService = require("./ConfigurationService");
const TimeService = require("./ReservationTimeService");
const Lifecycle = require("./ReservationLifecycleService");

const MAX_AVAILABILITY_RANGE_DAYS = 366;

const defaultDependencies = {
  ConfigService,
  ReservationRepository,
  ConfigurationService,
  TimeService,
  now: function now() {
    return new Date();
  }
};

function asDate(value, fieldName) {
  var date = null;

  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const invalidError = new Error("Invalid date: " + fieldName);
    invalidError.statusCode = 400;
    throw invalidError;
  }

  try {
    date = TimeService.parseDateOnlyAsUtc(value);
  } catch (_error) {
    const invalidError = new Error("Invalid date: " + fieldName);
    invalidError.statusCode = 400;
    throw invalidError;
  }

  if (!date || Number.isNaN(date.getTime())) {
    const error = new Error("Invalid date: " + fieldName);
    error.statusCode = 400;
    throw error;
  }

  date.setUTCHours(0, 0, 0, 0);
  return date;
}

function overlaps(rangeAStart, rangeAEnd, rangeBStart, rangeBEnd) {
  return rangeAStart <= rangeBEnd && rangeBStart <= rangeAEnd;
}

function toIsoDate(date) {
  var month = String(date.getUTCMonth() + 1).padStart(2, "0");
  var day = String(date.getUTCDate()).padStart(2, "0");
  return date.getUTCFullYear() + "-" + month + "-" + day;
}

function isIsoDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isStalePending(reservation, dependencies) {
  if (reservation.status !== Lifecycle.RESERVATION_STATUS.PENDING) {
    return false;
  }

  const paymentStatus = String(reservation.paymentStatus || "").toLowerCase();
  if (paymentStatus === "paid") {
    return false;
  }

  const expiresAt = reservation.pendingExpiresAt
    || (reservation.createdAt
      ? TimeService.getPendingExpiration(
        reservation.createdAt,
        dependencies.ConfigurationService.getReservationPendingExpiryHours()
      ).toISOString()
      : "");

  if (!expiresAt) {
    return false;
  }

  return new Date(expiresAt).getTime() <= dependencies.now().getTime();
}

function reservedPadsOnDate(date, reservations, dependencies) {
  var reserved = 0;

  reservations.forEach(function (reservation) {
    if (!Lifecycle.isBlockingStatus(reservation.status) || isStalePending(reservation, dependencies)) {
      return;
    }

    if (!isIsoDate(reservation.fromDate) || !isIsoDate(reservation.toDate)) {
      return;
    }

    var existingFrom = asDate(reservation.fromDate, "reservation.fromDate");
    var existingTo = asDate(reservation.toDate, "reservation.toDate");

    if (overlaps(date, date, existingFrom, existingTo)) {
      reserved += Number(reservation.pads || 0);
    }
  });

  return reserved;
}

function createAvailabilityService(customDependencies) {
  const dependencies = {
    ...defaultDependencies,
    ...(customDependencies || {})
  };

  async function getAvailability(params) {
    const from = asDate(params.from, "from");
    const to = asDate(params.to, "to");

    if (from.getTime() > to.getTime()) {
      const error = new Error("from cannot be later than to");
      error.statusCode = 400;
      throw error;
    }

    const rangeDays = Math.floor((to.getTime() - from.getTime()) / 86400000) + 1;
    if (rangeDays > MAX_AVAILABILITY_RANGE_DAYS) {
      const error = new Error("Availability date range is too long");
      error.statusCode = 400;
      error.code = "AvailabilityRangeTooLong";
      throw error;
    }

    const config = await dependencies.ConfigService.loadConfig();
    let reservations = [];

    try {
      reservations = await dependencies.ReservationRepository.getReservations();
    } catch (error) {
      const availabilityError = new Error("Availability storage is temporarily unavailable");
      availabilityError.statusCode = 503;
      availabilityError.code = "AvailabilityUnavailable";
      availabilityError.details = error && error.message;
      throw availabilityError;
    }

    const maxPads = Number((config.availability && config.availability.totalPads) || 0);

    if (!maxPads || maxPads < 1) {
      return {
        available: false,
        remainingPads: 0,
        days: {},
        message: "Availability is not configured"
      };
    }

    let maxReservedOnAnyDay = 0;
    const days = {};
    const cursor = new Date(from);

    while (cursor.getTime() <= to.getTime()) {
      const reservedOnDay = reservedPadsOnDate(cursor, reservations, dependencies);
      const remainingOnDay = Math.max(0, maxPads - reservedOnDay);

      days[toIsoDate(cursor)] = remainingOnDay;

      if (reservedOnDay > maxReservedOnAnyDay) {
        maxReservedOnAnyDay = reservedOnDay;
      }

      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }

    const remainingPads = Math.max(0, maxPads - maxReservedOnAnyDay);

    return {
      available: remainingPads > 0,
      remainingPads: remainingPads,
      days: days,
      message: remainingPads > 0 ? "Pads available" : "No pads available for selected dates"
    };
  }

  return {
    getAvailability
  };
}

let activeService = createAvailabilityService();

function __setDependencies(overrides) {
  activeService = createAvailabilityService(overrides);
}

function __resetDependencies() {
  activeService = createAvailabilityService();
}

module.exports = {
  getAvailability: function getAvailabilityProxy(params) {
    return activeService.getAvailability(params);
  },
  createAvailabilityService,
  __setDependencies,
  __resetDependencies
};
