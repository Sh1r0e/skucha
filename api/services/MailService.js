const { EmailClient } = require("@azure/communication-email");
const ConfigurationService = require("./ConfigurationService");

const defaultDependencies = {
  EmailClient,
  ConfigurationService
};

function normalizeMailMode(value) {
  return String(value || process.env.MAIL_MODE || "log-only").toLowerCase();
}

function createConfigurationError(message, code) {
  const error = new Error(message);
  error.statusCode = 503;
  error.code = code || "MailNotConfigured";
  return error;
}

function normalizeReservation(reservation) {
  const source = reservation || {};
  const payment = source.payment || {};

  return {
    id: source.id || "-",
    status: source.status || "Pending",
    fullName: source.fullName || source.customerName || "-",
    email: source.email || source.customerEmail || "-",
    phone: source.phone || source.customerPhone || "-",
    dateFrom: source.dateFrom || source.fromDate || "-",
    dateTo: source.dateTo || source.toDate || "-",
    padsCount: source.padsCount || source.pads || "-",
    deliveryMethod: source.deliveryMethod || "-",
    pickupPoint: source.pickupPoint || "-",
    notes: source.notes || "-",
    amount: source.amount || payment.amount || "-",
    currency: String(source.currency || payment.currency || "PLN").toUpperCase(),
    paymentStatus: source.paymentStatus || payment.status || "-",
    paymentSessionId: source.paymentSessionId || payment.sessionId || "-",
    checkoutUrl: source.checkoutUrl || payment.checkoutUrl || "",
    cancelUrl: source.cancelUrl || source.cancellationUrl || "",
    cancelExpiresAt: source.cancelExpiresAt || source.cancellationExpiresAt || "-"
  };
}

function buildReservationDetails(reservation) {
  const details = normalizeReservation(reservation);

  return [
    "Szczegoly rezerwacji:",
    "- ID: " + details.id,
    "- Status rezerwacji: " + details.status,
    "- Imie i nazwisko: " + details.fullName,
    "- Email: " + details.email,
    "- Telefon: " + details.phone,
    "- Termin: " + details.dateFrom + " - " + details.dateTo,
    "- Liczba padow: " + String(details.padsCount),
    "- Sposob odbioru: " + details.deliveryMethod,
    "- Punkt odbioru: " + details.pickupPoint,
    "- Uwagi: " + details.notes,
    "- Kwota: " + String(details.amount) + " " + details.currency
  ];
}

function buildPaymentDetails(reservation) {
  const details = normalizeReservation(reservation);
  const lines = [
    "Szczegoly platnosci:",
    "- Status platnosci: " + details.paymentStatus,
    "- Stripe Session ID: " + details.paymentSessionId,
    "- Kwota: " + String(details.amount) + " " + details.currency
  ];

  if (details.checkoutUrl) {
    lines.push("- Link do platnosci: " + details.checkoutUrl);
  }

  return lines;
}

function buildCancellationDetails(reservation) {
  const details = normalizeReservation(reservation);

  if (!details.cancelUrl) {
    return [];
  }

  return [
    "Link do anulowania rezerwacji i zwrotu:",
    details.cancelUrl,
    "Link wygasa: " + details.cancelExpiresAt
  ];
}

function buildReservationEmail(reservation) {
  const details = normalizeReservation(reservation);
  const lines = [
    "Rezerwacja w Skucha zostala utworzona.",
    "",
    "Aby zakonczyc rezerwacje, dokoncz platnosc przez Stripe.",
    "",
    ...buildReservationDetails(details),
    "",
    ...buildPaymentDetails(details),
    ""
  ];

  if (details.checkoutUrl) {
    lines.push("", "Link do checkoutu Stripe:", details.checkoutUrl);
  }

  const cancellationDetails = buildCancellationDetails(details);

  if (cancellationDetails.length) {
    lines.push("", ...cancellationDetails);
    lines.push("");
  }

  lines.push("Wiadomosc automatyczna z adresu noreply@skucha.co.");

  return lines.join("\n");
}

function buildPaymentEmail(reservation, title, introduction) {
  const lines = [
    title,
    "",
    introduction,
    "",
    ...buildReservationDetails(reservation),
    "",
    ...buildPaymentDetails(reservation)
  ];
  const cancellationDetails = buildCancellationDetails(reservation);

  if (cancellationDetails.length) {
    lines.push("", ...cancellationDetails);
  }

  lines.push("", "Wiadomosc automatyczna z adresu noreply@skucha.co.");
  return lines.join("\n");
}

function buildCancellationEmail(reservation, cancellationResult) {
  const details = normalizeReservation(reservation);

  return [
    "Potwierdzamy anulowanie rezerwacji.",
    "",
    ...buildReservationDetails(details),
    "",
    "- Status rezerwacji: " + (cancellationResult.status || "Cancelled"),
    "- Status platnosci: " + (cancellationResult.paymentStatus || "RefundPending"),
    "- Stripe refund id: " + ((cancellationResult.refund && cancellationResult.refund.refundId) || "-"),
    "",
    "Jesli potrzebujesz wsparcia, odpowiedz na wiadomosc z formularza kontaktowego na stronie.",
    "Wiadomosc automatyczna z adresu noreply@skucha.co."
  ].join("\n");
}

function createMailService(customDependencies) {
  const dependencies = {
    ...defaultDependencies,
    ...(customDependencies || {})
  };

  let client = null;

  function getClient() {
    if (client) {
      return client;
    }

    if (dependencies.emailClient) {
      client = dependencies.emailClient;
      return client;
    }

    const connectionString = dependencies.ConfigurationService.getAcsConnectionString();

    if (!connectionString) {
      throw createConfigurationError("ACS connection string is not configured", "MailNotConfigured");
    }

    client = new dependencies.EmailClient(connectionString);
    return client;
  }

  async function sendMessage(message) {
    const mode = normalizeMailMode();

    if (mode !== "acs-email") {
      return {
        queued: true,
        mode: mode,
        recipient: message.to,
        operationId: "log-only"
      };
    }

    const senderAddress = dependencies.ConfigurationService.getAcsSenderAddress();

    if (!senderAddress) {
      throw createConfigurationError("ACS sender address is not configured", "MailSenderNotConfigured");
    }

    const emailClient = getClient();

    const poller = await emailClient.beginSend({
      senderAddress: senderAddress,
      content: {
        subject: message.subject,
        plainText: message.bodyText
      },
      recipients: {
        to: [
          {
            address: message.to,
            displayName: message.toName || message.to
          }
        ]
      }
    });

    const response = await poller.pollUntilDone();

    return {
      queued: true,
      mode: mode,
      recipient: message.to,
      operationId: response && response.id ? response.id : ""
    };
  }

  async function sendReservationNotification(reservation) {
    const bodyText = buildReservationEmail(reservation || {});

    return sendMessage({
      to: (reservation && reservation.email) || process.env.RESERVATION_NOTIFY_EMAIL || "kontakt@skucha.pl",
      toName: (reservation && reservation.fullName) || "Klient",
      subject: "Skucha - rezerwacja utworzona - oczekiwanie na platnosc",
      bodyText: bodyText
    });
  }

  async function sendPaymentPendingNotification(reservation) {
    const bodyText = buildPaymentEmail(
      reservation || {},
      "Platnosc Skucha oczekuje na potwierdzenie.",
      "Checkout zostal zakonczony, ale Stripe nie potwierdzil jeszcze platnosci. Otrzymasz kolejna wiadomosc po zmianie statusu."
    );

    return sendMessage({
      to: (reservation && (reservation.email || reservation.customerEmail)) || "",
      toName: (reservation && (reservation.fullName || reservation.customerName)) || "Klient",
      subject: "Skucha - platnosc oczekuje na potwierdzenie",
      bodyText: bodyText
    });
  }

  async function sendPaymentConfirmationNotification(reservation) {
    const bodyText = buildPaymentEmail(
      reservation || {},
      "Platnosc potwierdzona - rezerwacja w Skucha jest potwierdzona.",
      "Dziekujemy za platnosc. Ponizej znajdziesz komplet szczegolow rezerwacji i platnosci."
    );

    return sendMessage({
      to: (reservation && (reservation.email || reservation.customerEmail)) || "",
      toName: (reservation && (reservation.fullName || reservation.customerName)) || "Klient",
      subject: "Skucha - platnosc potwierdzona",
      bodyText: bodyText
    });
  }

  async function sendPaymentExpiredNotification(reservation) {
    const bodyText = buildPaymentEmail(
      reservation || {},
      "Sesja platnosci Skucha wygasla.",
      "Sesja checkoutu Stripe wygasla i platnosc nie zostala potwierdzona. Skontaktuj sie z nami, aby ustalic dalsze kroki."
    );

    return sendMessage({
      to: (reservation && (reservation.email || reservation.customerEmail)) || "",
      toName: (reservation && (reservation.fullName || reservation.customerName)) || "Klient",
      subject: "Skucha - sesja platnosci wygasla",
      bodyText: bodyText
    });
  }

  async function sendCancellationNotification(reservation, cancellationResult) {
    const bodyText = buildCancellationEmail(reservation || {}, cancellationResult || {});

    return sendMessage({
      to: (reservation && reservation.customerEmail) || (reservation && reservation.email) || "",
      toName: (reservation && reservation.customerName) || "Klient",
      subject: "Skucha - anulowanie rezerwacji",
      bodyText: bodyText
    });
  }

  return {
    sendReservationNotification,
    sendPaymentPendingNotification,
    sendPaymentConfirmationNotification,
    sendPaymentExpiredNotification,
    sendCancellationNotification
  };
}

let activeService = createMailService();

function __setDependencies(overrides) {
  activeService = createMailService(overrides);
}

function __resetDependencies() {
  activeService = createMailService();
}

module.exports = {
  sendReservationNotification: function sendReservationNotificationProxy(reservation) {
    return activeService.sendReservationNotification(reservation);
  },
  sendPaymentPendingNotification: function sendPaymentPendingNotificationProxy(reservation) {
    return activeService.sendPaymentPendingNotification(reservation);
  },
  sendPaymentConfirmationNotification: function sendPaymentConfirmationNotificationProxy(reservation) {
    return activeService.sendPaymentConfirmationNotification(reservation);
  },
  sendPaymentExpiredNotification: function sendPaymentExpiredNotificationProxy(reservation) {
    return activeService.sendPaymentExpiredNotification(reservation);
  },
  sendCancellationNotification: function sendCancellationNotificationProxy(reservation, cancellationResult) {
    return activeService.sendCancellationNotification(reservation, cancellationResult);
  },
  createMailService,
  __setDependencies,
  __resetDependencies
};
