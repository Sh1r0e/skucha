const ConfigService = require("./ConfigService");
const ReservationRepository = require("../repositories/ReservationRepository");

const BLOCKING_STATUSES = ["Pending", "Confirmed"];

function asDate(value, fieldName) {
  var date = null;

  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    var parts = value.split("-").map(Number);
    date = new Date(parts[0], parts[1] - 1, parts[2]);
  } else {
    date = new Date(value);
  }

  if (!date || Number.isNaN(date.getTime())) {
    const error = new Error("Invalid date: " + fieldName);
    error.statusCode = 400;
    throw error;
  }

  date.setHours(0, 0, 0, 0);
  return date;
}

function overlaps(rangeAStart, rangeAEnd, rangeBStart, rangeBEnd) {
  return rangeAStart <= rangeBEnd && rangeBStart <= rangeAEnd;
}

function toIsoDate(date) {
  var month = String(date.getMonth() + 1).padStart(2, "0");
  var day = String(date.getDate()).padStart(2, "0");
  return date.getFullYear() + "-" + month + "-" + day;
}

function reservedPadsOnDate(date, reservations) {
  var reserved = 0;

  reservations.forEach(function (reservation) {
    if (BLOCKING_STATUSES.indexOf(reservation.status) === -1) {
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

async function getAvailability(params) {
  const from = asDate(params.from, "from");
  const to = asDate(params.to, "to");

  if (from.getTime() > to.getTime()) {
    const error = new Error("from cannot be later than to");
    error.statusCode = 400;
    throw error;
  }

  const config = await ConfigService.loadConfig();
  const reservations = await ReservationRepository.getReservations();
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
    const reservedOnDay = reservedPadsOnDate(cursor, reservations);
    const remainingOnDay = Math.max(0, maxPads - reservedOnDay);

    days[toIsoDate(cursor)] = remainingOnDay;

    if (reservedOnDay > maxReservedOnAnyDay) {
      maxReservedOnAnyDay = reservedOnDay;
    }

    cursor.setDate(cursor.getDate() + 1);
  }

  const remainingPads = Math.max(0, maxPads - maxReservedOnAnyDay);

  return {
    available: remainingPads > 0,
    remainingPads: remainingPads,
    days: days,
    message: remainingPads > 0 ? "Pads available" : "No pads available for selected dates"
  };
}

module.exports = {
  getAvailability
};
