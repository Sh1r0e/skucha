const MailService = require("../../../services/MailService");

describe("MailService", function () {
  it("should_return_deterministic_log_only_payload()", async function () {
    process.env.MAIL_MODE = "log-only";
    process.env.RESERVATION_NOTIFY_EMAIL = "ops@example.com";

    const result = await MailService.sendReservationNotification({
      fullName: "Jan Kowalski",
      dateFrom: "2026-08-10",
      dateTo: "2026-08-12",
      padsCount: 2
    });

    expect(result).toMatchObject({
      queued: true,
      mode: "log-only",
      recipient: "ops@example.com"
    });
  });

  it("should_use_default_values_when_environment_is_missing()", async function () {
    delete process.env.MAIL_MODE;
    delete process.env.RESERVATION_NOTIFY_EMAIL;

    const result = await MailService.sendReservationNotification({
      fullName: "Jan Kowalski",
      dateFrom: "2026-08-10",
      dateTo: "2026-08-12",
      padsCount: 2
    });

    expect(result).toMatchObject({
      queued: true,
      mode: "log-only",
      recipient: "kontakt@skucha.pl"
    });
  });
});
