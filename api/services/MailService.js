async function sendReservationNotification(reservation) {
  // Phase 1: keep transport implementation simple. Swap to SendGrid/SMTP in later phase.
  return {
    queued: true,
    mode: process.env.MAIL_MODE || "log-only",
    recipient: process.env.RESERVATION_NOTIFY_EMAIL || "kontakt@skucha.pl",
    summary: {
      fullName: reservation.fullName,
      dateFrom: reservation.dateFrom,
      dateTo: reservation.dateTo,
      padsCount: reservation.padsCount
    }
  };
}

module.exports = {
  sendReservationNotification
};
