const ReservationRepository = require("../repositories/ReservationRepository");
const StripeService = require("./StripeService");
const MailService = require("./MailService");
const ConfigurationService = require("./ConfigurationService");
const TimeService = require("./ReservationTimeService");
const Lifecycle = require("./ReservationLifecycleService");

const defaultDependencies = {
  ReservationRepository,
  StripeService,
  MailService,
  ConfigurationService,
  TimeService,
  now: function now() {
    return new Date();
  }
};

function getExpiryTime(reservation, dependencies) {
  if (reservation.pendingExpiresAt) {
    return new Date(reservation.pendingExpiresAt);
  }

  if (reservation.createdAt) {
    const hours = typeof dependencies.ConfigurationService.getReservationPendingExpiryHours === "function"
      ? dependencies.ConfigurationService.getReservationPendingExpiryHours()
      : 2;
    return dependencies.TimeService.getPendingExpiration(reservation.createdAt, hours);
  }

  return null;
}

function isUnpaidPending(reservation) {
  return reservation.status === Lifecycle.RESERVATION_STATUS.PENDING
    && ["", "unpaid", "pending", "expired"].includes(
      String(reservation.paymentStatus || "").toLowerCase()
    );
}

function createHousekeepingService(customDependencies) {
  const dependencies = {
    ...defaultDependencies,
    ...(customDependencies || {})
  };

  async function expirePendingReservations(options) {
    const settings = options || {};
    const dryRun = Boolean(settings.dryRun);
    const limit = Math.max(1, Math.min(Number(settings.limit) || 100, 500));
    const now = dependencies.now();
    const reservations = await dependencies.ReservationRepository.getReservations();
    const result = {
      dryRun,
      scanned: reservations.length,
      eligible: 0,
      expired: 0,
      skipped: 0,
      errors: []
    };

    const candidates = reservations.filter(function (reservation) {
      if (!isUnpaidPending(reservation)) {
        return false;
      }

      const expiry = getExpiryTime(reservation, dependencies);
      return expiry && !Number.isNaN(expiry.getTime()) && expiry.getTime() <= now.getTime();
    }).slice(0, limit);

    result.eligible = candidates.length;

    if (dryRun) {
      result.expired = candidates.length;
      return result;
    }

    for (const reservation of candidates) {
      let checkout = null;

      try {
        if (reservation.paymentSessionId && typeof dependencies.StripeService.expireCheckoutSession === "function") {
          checkout = await dependencies.StripeService.expireCheckoutSession(reservation.paymentSessionId);

          if (checkout.paymentStatus === "Paid") {
            result.skipped += 1;
            result.errors.push({ id: reservation.id, code: "PaidDuringHousekeeping" });
            continue;
          }
        }

        const paymentUpdate = await dependencies.ReservationRepository.attachPayment(
          reservation.id,
          {
            sessionId: reservation.paymentSessionId,
            paymentUrl: reservation.paymentUrl,
            paymentStatus: "Expired",
            expiredAt: now.toISOString()
          },
          {
            expectedStatus: Lifecycle.RESERVATION_STATUS.PENDING,
            expectedEtag: reservation.etag
          }
        );

        if (!paymentUpdate) {
          result.skipped += 1;
          result.errors.push({ id: reservation.id, code: "NotFound" });
          continue;
        }

        const statusUpdate = await dependencies.ReservationRepository.updateStatus(
          reservation.id,
          Lifecycle.RESERVATION_STATUS.EXPIRED,
          {
            expectedStatus: Lifecycle.RESERVATION_STATUS.PENDING,
            expectedEtag: paymentUpdate.etag
          }
        );

        if (!statusUpdate) {
          result.skipped += 1;
          result.errors.push({ id: reservation.id, code: "NotFound" });
          continue;
        }

        result.expired += 1;

        try {
          await dependencies.MailService.sendPaymentExpiredNotification({
            ...reservation,
            status: Lifecycle.RESERVATION_STATUS.EXPIRED,
            paymentStatus: "Expired"
          });
        } catch (mailError) {
          result.errors.push({
            id: reservation.id,
            code: "NotificationFailed",
            message: mailError.message
          });
        }
      } catch (error) {
        result.skipped += 1;
        result.errors.push({
          id: reservation.id,
          code: error.code || "HousekeepingFailed",
          message: error.message
        });
      }
    }

    return result;
  }

  return { expirePendingReservations };
}

let activeService = createHousekeepingService();

function __setDependencies(overrides) {
  activeService = createHousekeepingService(overrides);
}

function __resetDependencies() {
  activeService = createHousekeepingService();
}

module.exports = {
  expirePendingReservations: function expirePendingReservationsProxy(options) {
    return activeService.expirePendingReservations(options);
  },
  createHousekeepingService,
  __setDependencies,
  __resetDependencies
};
