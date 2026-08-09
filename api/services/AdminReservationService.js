const ReservationRepository = require("../repositories/ReservationRepository");
const Lifecycle = require("./ReservationLifecycleService");

const defaultDependencies = {
  ReservationRepository,
  now: function now() {
    return new Date();
  }
};

function badRequest(message, code) {
  const error = new Error(message);
  error.statusCode = 400;
  error.code = code || "BadRequest";
  return error;
}

function conflict(message, code) {
  const error = new Error(message);
  error.statusCode = 409;
  error.code = code || "ReservationConflict";
  return error;
}

function assertDate(value, fieldName) {
  const parsed = new Date(value);
  if (!value || Number.isNaN(parsed.getTime())) {
    throw badRequest(fieldName + " must be a valid ISO date", "InvalidDate");
  }
  return parsed.toISOString();
}

function createAdminReservationService(customDependencies) {
  const dependencies = {
    ...defaultDependencies,
    ...(customDependencies || {})
  };

  async function listReservations(filters) {
    const options = filters || {};
    const reservations = await dependencies.ReservationRepository.getReservations();
    const status = options.status ? String(options.status) : "";
    const activeOnly = String(options.active || "").toLowerCase() === "true";

    return reservations
      .filter(function (reservation) {
        if (status && reservation.status !== status) {
          return false;
        }
        if (activeOnly && !Lifecycle.isBlockingStatus(reservation.status)) {
          return false;
        }
        return true;
      })
      .sort(function (left, right) {
        return String(left.fromDate || "").localeCompare(String(right.fromDate || ""));
      });
  }

  async function collectReservation(payload) {
    const input = payload || {};
    const reservationId = String(input.reservationId || "").trim();
    if (!reservationId) {
      throw badRequest("reservationId is required", "MissingReservationId");
    }

    const expectedReturnAt = assertDate(input.expectedReturnAt, "expectedReturnAt");
    const reservation = await dependencies.ReservationRepository.getReservation(reservationId);
    if (!reservation) {
      throw conflict("Reservation not found", "NotFound");
    }

    Lifecycle.assertTransition(
      reservation.status,
      Lifecycle.RESERVATION_STATUS.IN_PROGRESS,
      Lifecycle.ACTOR.ADMIN
    );

    const updated = await dependencies.ReservationRepository.updateReservation(
      reservationId,
      {
        status: Lifecycle.RESERVATION_STATUS.IN_PROGRESS,
        collectedAt: dependencies.now().toISOString(),
        expectedReturnAt: expectedReturnAt,
        handledBy: String(input.handledBy || "").trim(),
        handoverNotes: String(input.handoverNotes || "").trim()
      },
      {
        expectedStatus: Lifecycle.RESERVATION_STATUS.CONFIRMED,
        expectedEtag: reservation.etag
      }
    );

    if (!updated) {
      throw conflict("Reservation changed before collection", "StorageConflict");
    }

    return updated;
  }

  async function completeReservation(payload) {
    const input = payload || {};
    const reservationId = String(input.reservationId || "").trim();
    if (!reservationId) {
      throw badRequest("reservationId is required", "MissingReservationId");
    }

    const reservation = await dependencies.ReservationRepository.getReservation(reservationId);
    if (!reservation) {
      throw conflict("Reservation not found", "NotFound");
    }

    Lifecycle.assertTransition(
      reservation.status,
      Lifecycle.RESERVATION_STATUS.COMPLETED,
      Lifecycle.ACTOR.ADMIN
    );

    const returnedAt = input.returnedAt
      ? assertDate(input.returnedAt, "returnedAt")
      : dependencies.now().toISOString();
    const updated = await dependencies.ReservationRepository.updateReservation(
      reservationId,
      {
        status: Lifecycle.RESERVATION_STATUS.COMPLETED,
        returnedAt: returnedAt,
        handledBy: String(input.handledBy || reservation.handledBy || "").trim(),
        handoverNotes: input.handoverNotes === undefined
          ? reservation.handoverNotes
          : String(input.handoverNotes || "").trim()
      },
      {
        expectedStatus: Lifecycle.RESERVATION_STATUS.IN_PROGRESS,
        expectedEtag: reservation.etag
      }
    );

    if (!updated) {
      throw conflict("Reservation changed before return", "StorageConflict");
    }

    return updated;
  }

  return { listReservations, collectReservation, completeReservation };
}

let activeService = createAdminReservationService();

function __setDependencies(overrides) {
  activeService = createAdminReservationService(overrides);
}

function __resetDependencies() {
  activeService = createAdminReservationService();
}

module.exports = {
  listReservations: function listReservationsProxy(filters) {
    return activeService.listReservations(filters);
  },
  collectReservation: function collectReservationProxy(payload) {
    return activeService.collectReservation(payload);
  },
  completeReservation: function completeReservationProxy(payload) {
    return activeService.completeReservation(payload);
  },
  createAdminReservationService,
  __setDependencies,
  __resetDependencies
};
