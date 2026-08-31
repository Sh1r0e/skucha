const MailService = require("../../../services/MailService");

describe("MailService", function () {
  beforeEach(function () {
    MailService.__resetDependencies();
    vi.clearAllMocks();
  });

  it("should_return_log_only_payload_when_mail_mode_is_not_acs()", async function () {
    process.env.MAIL_MODE = "log-only";

    const result = await MailService.sendReservationNotification({
      fullName: "Jan Kowalski",
      email: "jan@example.com",
      dateFrom: "2026-08-10",
      dateTo: "2026-08-12",
      padsCount: 2
    });

    expect(result).toMatchObject({
      queued: true,
      mode: "log-only",
      recipient: "jan@example.com",
      operationId: "log-only"
    });
  });

  it("should_send_reservation_notification_with_acs_when_enabled()", async function () {
    process.env.MAIL_MODE = "acs-email";

    const beginSend = vi.fn().mockResolvedValue({
      pollUntilDone: vi.fn().mockResolvedValue({ id: "mail-op-1" })
    });

    MailService.__setDependencies({
      emailClient: {
        beginSend: beginSend
      },
      ConfigurationService: {
        getAcsConnectionString: vi.fn().mockReturnValue("endpoint=https://example"),
        getAcsSenderAddress: vi.fn().mockReturnValue("rental@skucha.co")
      }
    });

    const result = await MailService.sendReservationNotification({
      id: "res-1",
      fullName: "Jan Kowalski",
      email: "jan@example.com",
      phone: "+48500500500",
      dateFrom: "2026-08-10",
      dateTo: "2026-08-12",
      padsCount: 2,
      deliveryMethod: "pickup",
      pickupPoint: "Stablowice",
      amount: 120,
      currency: "PLN",
      payment: {
        checkoutUrl: "https://checkout.stripe.com/c/pay/cs_test_123"
      },
      cancelUrl: "https://www.skucha.co/api/reservation/cancel?reservation_id=res-1&token=abc",
      cancelExpiresAt: "2026-08-20T12:00:00.000Z"
    });

    expect(beginSend).toHaveBeenCalledTimes(1);
    expect(beginSend.mock.calls[0][0]).toMatchObject({
      senderAddress: "rental@skucha.co"
    });
    const html = beginSend.mock.calls[0][0].content.html;
    expect(html).toContain("Twoja rezerwacja");
    expect(html).toContain("Przejdź do płatności");
    expect(html).toContain("Co musisz wiedzieć");
    expect(html).toContain("Bouldering jest niebezpieczny");
    expect(html.indexOf("Przejdź do płatności")).toBeGreaterThan(html.indexOf("Oddajesz w umówionym terminie"));
    expect(html).not.toContain("<details");
    expect(html).not.toContain("<summary");
    expect(result).toMatchObject({
      queued: true,
      mode: "acs-email",
      recipient: "jan@example.com",
      operationId: "mail-op-1"
    });
  });

  it("should_send_cancellation_notification_with_acs_when_enabled()", async function () {
    process.env.MAIL_MODE = "acs-email";

    const beginSend = vi.fn().mockResolvedValue({
      pollUntilDone: vi.fn().mockResolvedValue({ id: "mail-op-2" })
    });

    MailService.__setDependencies({
      emailClient: {
        beginSend: beginSend
      },
      ConfigurationService: {
        getAcsConnectionString: vi.fn().mockReturnValue("endpoint=https://example"),
        getAcsSenderAddress: vi.fn().mockReturnValue("rental@skucha.co")
      }
    });

    const result = await MailService.sendCancellationNotification(
      {
        id: "res-1",
        customerName: "Jan Kowalski",
        customerEmail: "jan@example.com"
      },
      {
        status: "Cancelled",
        paymentStatus: "RefundPending",
        refund: { refundId: "re_1" }
      }
    );

    expect(beginSend).toHaveBeenCalledTimes(1);
    expect(result.operationId).toBe("mail-op-2");
  });

  it("should_include_complete_checkout_details_in_payment_confirmation_email()", async function () {
    process.env.MAIL_MODE = "acs-email";

    const beginSend = vi.fn().mockResolvedValue({
      pollUntilDone: vi.fn().mockResolvedValue({ id: "mail-op-3" })
    });

    MailService.__setDependencies({
      emailClient: { beginSend: beginSend },
      now: vi.fn().mockReturnValue(new Date("2026-08-01T10:00:00.000Z")),
      ConfigurationService: {
        getAcsConnectionString: vi.fn().mockReturnValue("endpoint=https://example"),
        getAcsSenderAddress: vi.fn().mockReturnValue("rental@skucha.co"),
        getReservationCancellationCutoffHours: vi.fn().mockReturnValue(24),
        getReservationTimezone: vi.fn().mockReturnValue("Europe/Warsaw")
      }
    });

    await MailService.sendPaymentConfirmationNotification({
      id: "res-1",
      status: "Confirmed",
      fullName: "Jan Kowalski",
      email: "jan@example.com",
      phone: "+48500500500",
      dateFrom: "2026-08-10",
      dateTo: "2026-08-12",
      padsCount: 2,
      deliveryMethod: "pickup",
      pickupPoint: "Stablowice",
      notes: "Bring extra straps",
      amount: 120,
      currency: "PLN",
      paymentStatus: "Paid",
      paymentSessionId: "cs_test_123",
      checkoutUrl: "https://checkout.stripe.com/c/pay/cs_test_123",
      cancelUrl: "https://www.skucha.co/api/reservation/cancel?reservation_id=res-1&token=abc",
      cancelExpiresAt: "2026-08-20T12:00:00.000Z"
    });

    const message = beginSend.mock.calls[0][0];
    const staffMessage = beginSend.mock.calls[1][0];

    expect(beginSend).toHaveBeenCalledTimes(2);
    expect(message.content.subject).toBe("Skucha - płatność potwierdzona");
    expect(message.content.plainText).toBeUndefined();
    expect(message.content.html).toContain("Twoja rezerwacja");
    expect(message.content.html).toContain("Black Diamond Circuit 2.0");
    expect(message.content.html).toContain("ID rezerwacji");
    expect(message.content.html).toContain("Kaucja zwrotna");
    expect(message.content.html).not.toContain("Stripe Session ID");
    expect(message.content.html).not.toContain("Stripe Payment Intent");
    expect(message.content.html).toContain("Co musisz wiedzieć");
    expect(message.content.html).toContain("Bouldering jest niebezpieczny");
    expect(message.content.html).toContain("Weź dokument tożsamości");
    expect(message.content.html).toContain("Normalne zużycie nic nie kosztuje");
    expect(message.content.html).toContain("Oddajesz w umówionym terminie");
    expect(message.content.html).toContain("Wysłano:");
    expect(message.content.html).not.toContain("<details");
    expect(message.content.html).not.toContain("<summary");
    expect(message.content.html).not.toContain(">Czynsz<");
    expect(message.content.html).toContain(">Zapłacono<");
    expect(message.content.html).not.toContain(">Do zapłaty teraz<");
    expect(message.content.html).toContain("Anuluj rezerwację i poproś o zwrot");
    expect(message.content.html).toContain("mailto:rental@skucha.co");
    expect(message.content.html.indexOf("Anuluj rezerwację i poproś o zwrot"))
      .toBeGreaterThan(message.content.html.indexOf("W załącznikach znajdziesz"));
    expect(message.content.html).not.toContain("△");
    expect(message.content.html).not.toContain("▣");
    expect(message.content.attachments).toBeUndefined();
    expect(message.attachments).toHaveLength(2);
    expect(message.attachments.map(function (attachment) { return attachment.name; })).toEqual([
      "rental-terms-v1.0.pdf",
      "privacy-policy-v1.0.pdf"
    ]);
    expect(message.attachments[0].contentType).toBe("application/pdf");
    expect(message.attachments[0].contentInBase64.length).toBeGreaterThan(100);
    expect(staffMessage.recipients.to.map(function (recipient) { return recipient.address; })).toEqual([
      "kubagrech@gmail.com",
      "kacperbednarz@icloud.com"
    ]);
    expect(staffMessage.content.subject).toBe("SKUCHA - opłacona rezerwacja res-1");
    expect(staffMessage.content.html).toContain("Dane operacyjne");
    expect(staffMessage.content.html).toContain("jan@example.com");
    expect(staffMessage.content.html).toContain("+48500500500");
    expect(staffMessage.content.html).toContain("cs_test_123");
    expect(staffMessage.content.html).toContain("Otwórz panel rezerwacji");
    expect(staffMessage.attachments).toBeUndefined();
  });

  it("should_send_expired_checkout_notification_with_acs_when_enabled()", async function () {
    process.env.MAIL_MODE = "acs-email";

    const beginSend = vi.fn().mockResolvedValue({
      pollUntilDone: vi.fn().mockResolvedValue({ id: "mail-op-4" })
    });

    MailService.__setDependencies({
      emailClient: { beginSend: beginSend },
      ConfigurationService: {
        getAcsConnectionString: vi.fn().mockReturnValue("endpoint=https://example"),
        getAcsSenderAddress: vi.fn().mockReturnValue("rental@skucha.co")
      }
    });

    const result = await MailService.sendPaymentExpiredNotification({
      customerName: "Jan Kowalski",
      customerEmail: "jan@example.com",
      paymentStatus: "Expired"
    });

    expect(beginSend.mock.calls[0][0].content.subject).toBe("Skucha - sesja płatności wygasła");
    expect(result.operationId).toBe("mail-op-4");
  });

  it("should_support_repository_shaped_reservation_data_in_pending_email()", async function () {
    process.env.MAIL_MODE = "log-only";

    const result = await MailService.sendPaymentPendingNotification({
      customerName: "Jan Kowalski",
      customerEmail: "jan@example.com",
      customerPhone: "+48500500500",
      fromDate: "2026-08-10",
      toDate: "2026-08-12",
      pads: 2,
      payment: {
        amount: 120,
        currency: "pln",
        status: "Unpaid",
        sessionId: "cs_test_123",
        checkoutUrl: "https://checkout.stripe.com/c/pay/cs_test_123"
      },
      cancellationUrl: "https://www.skucha.co/api/reservation/cancel?reservation_id=res-1&token=abc",
      cancellationExpiresAt: "2026-08-20T12:00:00.000Z"
    });

    expect(result).toMatchObject({
      mode: "log-only",
      recipient: "jan@example.com"
    });
  });

  it("should_hide_the_refund_action_inside_the_24_hour_cutoff", async function () {
    process.env.MAIL_MODE = "acs-email";
    const beginSend = vi.fn().mockResolvedValue({
      pollUntilDone: vi.fn().mockResolvedValue({ id: "mail-op-cutoff" })
    });

    MailService.__setDependencies({
      emailClient: { beginSend: beginSend },
      now: vi.fn().mockReturnValue(new Date("2026-08-09T10:00:00.000Z")),
      ConfigurationService: {
        getAcsConnectionString: vi.fn().mockReturnValue("endpoint=https://example"),
        getAcsSenderAddress: vi.fn().mockReturnValue("rental@skucha.co"),
        getReservationCancellationCutoffHours: vi.fn().mockReturnValue(24),
        getReservationTimezone: vi.fn().mockReturnValue("Europe/Warsaw")
      }
    });

    await MailService.sendPaymentConfirmationNotification({
      id: "res-cutoff",
      email: "jan@example.com",
      dateFrom: "2026-08-10",
      dateTo: "2026-08-10",
      cancelUrl: "https://www.skucha.co/reservation-cancel.html?reservation_id=res-cutoff&token=abc"
    });

    const content = beginSend.mock.calls[0][0].content;
    expect(content.html).not.toContain("reservation-cancel.html");
    expect(content.html).toContain("Termin bezpłatnego anulowania ze zwrotem minął");
    expect(content.plainText).toBeUndefined();
  });

  it("should_use_default_values_for_sparse_checkout_notification()", async function () {
    process.env.MAIL_MODE = "log-only";

    const result = await MailService.sendPaymentExpiredNotification({});

    expect(result).toMatchObject({
      mode: "log-only",
      recipient: ""
    });
  });

  it("should_report_missing_acs_connection_string()", async function () {
    process.env.MAIL_MODE = "acs-email";

    MailService.__setDependencies({
      ConfigurationService: {
        getAcsConnectionString: vi.fn().mockReturnValue(""),
        getAcsSenderAddress: vi.fn().mockReturnValue("rental@skucha.co")
      }
    });

    await expect(MailService.sendReservationNotification({ email: "jan@example.com" })).rejects.toMatchObject({
      statusCode: 503,
      code: "MailNotConfigured"
    });
  });

  it("should_report_missing_acs_sender_address()", async function () {
    process.env.MAIL_MODE = "acs-email";

    MailService.__setDependencies({
      ConfigurationService: {
        getAcsConnectionString: vi.fn().mockReturnValue("endpoint=https://example"),
        getAcsSenderAddress: vi.fn().mockReturnValue("")
      }
    });

    await expect(MailService.sendReservationNotification({ email: "jan@example.com" })).rejects.toMatchObject({
      statusCode: 503,
      code: "MailSenderNotConfigured"
    });
  });

  it("should_create_acs_client_and_allow_missing_operation_id()", async function () {
    process.env.MAIL_MODE = "acs-email";
    const beginSend = vi.fn().mockResolvedValue({
      pollUntilDone: vi.fn().mockResolvedValue(null)
    });
    const EmailClient = vi.fn().mockImplementation(function () {
      return { beginSend: beginSend };
    });

    MailService.__setDependencies({
      EmailClient: EmailClient,
      ConfigurationService: {
        getAcsConnectionString: vi.fn().mockReturnValue("endpoint=https://example"),
        getAcsSenderAddress: vi.fn().mockReturnValue("rental@skucha.co")
      }
    });

    const result = await MailService.sendPaymentConfirmationNotification({
      email: "jan@example.com"
    });

    expect(EmailClient).toHaveBeenCalledWith("endpoint=https://example");
    expect(result.operationId).toBe("");
  });

  it("should_send_cancellation_notification_with_default_result_details()", async function () {
    process.env.MAIL_MODE = "log-only";

    const result = await MailService.sendCancellationNotification({}, {});

    expect(result).toMatchObject({
      mode: "log-only",
      recipient: ""
    });
  });

  it("should_reuse_cached_acs_client_for_multiple_messages()", async function () {
    process.env.MAIL_MODE = "acs-email";

    const beginSend = vi.fn().mockResolvedValue({
      pollUntilDone: vi.fn().mockResolvedValue({ id: "mail-op-cache" })
    });
    const emailClient = { beginSend: beginSend };

    MailService.__setDependencies({
      emailClient: emailClient,
      ConfigurationService: {
        getAcsConnectionString: vi.fn().mockReturnValue("endpoint=https://example"),
        getAcsSenderAddress: vi.fn().mockReturnValue("rental@skucha.co")
      }
    });

    await MailService.sendPaymentConfirmationNotification({ email: "jan@example.com" });
    await MailService.sendPaymentExpiredNotification({ email: "jan@example.com" });

    expect(beginSend).toHaveBeenCalledTimes(3);
  });

  it("should_render_html_for_single_day_and_long_period_in_pln()", async function () {
    process.env.MAIL_MODE = "acs-email";

    const beginSend = vi.fn().mockResolvedValue({
      pollUntilDone: vi.fn().mockResolvedValue({ id: "mail-op-variants" })
    });

    MailService.__setDependencies({
      emailClient: { beginSend: beginSend },
      ConfigurationService: {
        getAcsConnectionString: vi.fn().mockReturnValue("endpoint=https://example"),
        getAcsSenderAddress: vi.fn().mockReturnValue("rental@skucha.co")
      }
    });

    await MailService.sendPaymentPendingNotification({
      email: "jan@example.com",
      dateFrom: "2026-08-10",
      dateTo: "2026-08-10",
      padsCount: 0,
      amount: 99.5
    });
    await MailService.sendPaymentPendingNotification({
      email: "jan@example.com",
      dateFrom: "2026-08-10",
      dateTo: "2026-08-15",
      padsCount: 1,
      amount: 199,
      pickupPoint: "Stablowice"
    });

    expect(beginSend).toHaveBeenCalledTimes(2);
    expect(beginSend.mock.calls[0][0].content.html).toContain("99,50 zł");
    expect(beginSend.mock.calls[0][0].content.html).toContain("1 doba");
    expect(beginSend.mock.calls[1][0].content.html).toContain("15.08");
    expect(beginSend.mock.calls[1][0].content.html).toContain("199,00 zł");
  });

  it("should_default_to_log_only_when_mail_mode_is_unset()", async function () {
    const previousMailMode = process.env.MAIL_MODE;
    delete process.env.MAIL_MODE;

    try {
      const result = await MailService.sendPaymentExpiredNotification();

      expect(result).toMatchObject({
        queued: true,
        mode: "log-only",
        recipient: ""
      });
    } finally {
      if (previousMailMode === undefined) {
        delete process.env.MAIL_MODE;
      } else {
        process.env.MAIL_MODE = previousMailMode;
      }
    }
  });

  it("should_use_reservation_email_when_cancellation_customer_email_is_missing()", async function () {
    process.env.MAIL_MODE = "log-only";

    const result = await MailService.sendCancellationNotification({
      email: "jan@example.com"
    }, {});

    expect(result).toMatchObject({
      mode: "log-only",
      recipient: "jan@example.com"
    });
  });
});
