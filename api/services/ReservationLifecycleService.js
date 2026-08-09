const RESERVATION_STATUS = Object.freeze({
  PENDING: "Pending",
  CONFIRMED: "Confirmed",
  CANCELLED: "Cancelled",
  EXPIRED: "Expired",
  CANCELLATION_PENDING: "CancellationPending",
  IN_PROGRESS: "InProgress",
  COMPLETED: "Completed"
});

const ACTOR = Object.freeze({
  CUSTOMER: "customer",
  SYSTEM: "system",
  ADMIN: "admin"
});

const BLOCKING_STATUSES = Object.freeze([
  RESERVATION_STATUS.PENDING,
  RESERVATION_STATUS.CONFIRMED,
  RESERVATION_STATUS.CANCELLATION_PENDING,
  RESERVATION_STATUS.IN_PROGRESS
]);

const TERMINAL_STATUSES = Object.freeze([
  RESERVATION_STATUS.CANCELLED,
  RESERVATION_STATUS.EXPIRED,
  RESERVATION_STATUS.COMPLETED
]);

const TRANSITIONS = Object.freeze({
  [RESERVATION_STATUS.PENDING]: Object.freeze({
    [RESERVATION_STATUS.CONFIRMED]: [ACTOR.SYSTEM],
    [RESERVATION_STATUS.CANCELLED]: [ACTOR.CUSTOMER, ACTOR.SYSTEM],
    [RESERVATION_STATUS.EXPIRED]: [ACTOR.SYSTEM],
    [RESERVATION_STATUS.CANCELLATION_PENDING]: [ACTOR.CUSTOMER, ACTOR.SYSTEM]
  }),
  [RESERVATION_STATUS.CONFIRMED]: Object.freeze({
    [RESERVATION_STATUS.CANCELLATION_PENDING]: [ACTOR.CUSTOMER, ACTOR.SYSTEM],
    [RESERVATION_STATUS.CANCELLED]: [ACTOR.CUSTOMER, ACTOR.SYSTEM],
    [RESERVATION_STATUS.IN_PROGRESS]: [ACTOR.ADMIN]
  }),
  [RESERVATION_STATUS.CANCELLATION_PENDING]: Object.freeze({
    [RESERVATION_STATUS.CANCELLED]: [ACTOR.SYSTEM]
  }),
  [RESERVATION_STATUS.IN_PROGRESS]: Object.freeze({
    [RESERVATION_STATUS.COMPLETED]: [ACTOR.ADMIN]
  })
});

function isKnownStatus(status) {
  return Object.values(RESERVATION_STATUS).includes(status);
}

function isBlockingStatus(status) {
  return BLOCKING_STATUSES.includes(status);
}

function isTerminalStatus(status) {
  return TERMINAL_STATUSES.includes(status);
}

function canTransition(fromStatus, toStatus, actor) {
  if (!isKnownStatus(fromStatus) || !isKnownStatus(toStatus) || fromStatus === toStatus) {
    return false;
  }

  const allowedActors = TRANSITIONS[fromStatus] && TRANSITIONS[fromStatus][toStatus];
  return Boolean(allowedActors && allowedActors.includes(actor));
}

function assertTransition(fromStatus, toStatus, actor) {
  if (!canTransition(fromStatus, toStatus, actor)) {
    const error = new Error("Invalid reservation status transition");
    error.statusCode = 409;
    error.code = "InvalidStatusTransition";
    error.details = { fromStatus, toStatus, actor };
    throw error;
  }
}

module.exports = {
  ACTOR,
  BLOCKING_STATUSES,
  RESERVATION_STATUS,
  TERMINAL_STATUSES,
  assertTransition,
  canTransition,
  isBlockingStatus,
  isKnownStatus,
  isTerminalStatus
};
