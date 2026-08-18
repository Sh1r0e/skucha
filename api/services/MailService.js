const { EmailClient } = require("@azure/communication-email");
const fs = require("fs");
const path = require("path");
const ConfigurationService = require("./ConfigurationService");

const defaultDependencies = {
  EmailClient,
  ConfigurationService,
  readFileSync: fs.readFileSync,
  legalDirectory: path.join(__dirname, "..", "legal")
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
    paymentIntentId: source.paymentIntentId || payment.paymentIntentId || "",
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
    "- Punkt odbioru: " + details.pickupPoint,
    "- Uwagi: " + details.notes,
    "- Kwota: " + String(details.amount) + " " + details.currency,
    "- Kaucja zwrotna: " + formatMoney(details.padsCount === "-" ? 0 : Number(details.padsCount) * 200, "PLN") + " gotowka przy odbiorze"
  ];
}

function buildPaymentDetails(reservation, options) {
  const details = normalizeReservation(reservation);
  const lines = [
    "Szczegoly platnosci:",
    "- Status platnosci: " + details.paymentStatus,
    "- Kwota: " + String(details.amount) + " " + details.currency
  ];

  if (details.checkoutUrl && (!options || options.includeCheckoutUrl !== false)) {
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

  lines.push("Wiadomosc automatyczna z adresu rental@skucha.co.");

  return lines.join("\n");
}

function buildPaymentEmail(reservation, title, introduction, options) {
  const lines = [
    title,
    "",
    introduction,
    "",
    ...buildReservationDetails(reservation),
    "",
    ...buildPaymentDetails(reservation, options)
  ];
  const cancellationDetails = buildCancellationDetails(reservation);

  if (cancellationDetails.length) {
    lines.push("", ...cancellationDetails);
  }

  lines.push("", "Wiadomosc automatyczna z adresu rental@skucha.co.");
  return lines.join("\n");
}

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatMoney(value, currency) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return "-";
  }

  return number.toFixed(2).replace(".", ",") + " " + (String(currency || "PLN").toUpperCase() === "PLN" ? "zł" : String(currency).toUpperCase());
}

function formatEmailDate(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? match[3] + "." + match[2] : String(value || "-");
}

function formatEmailPeriod(details) {
  const start = new Date(String(details.dateFrom) + "T00:00:00Z");
  const end = new Date(String(details.dateTo || details.dateFrom) + "T00:00:00Z");
  const days = Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())
    ? 1
    : Math.floor(Math.abs(end.getTime() - start.getTime()) / 86400000) + 1;
  const word = days === 1 ? "doba" : (days >= 2 && days <= 4 ? "doby" : "dób");
  return formatEmailDate(details.dateFrom) + " → " + formatEmailDate(details.dateTo) + " · " + days + " " + word;
}

function buildEmailSummaryHtml(details) {
  const pads = Number(details.padsCount) || 0;
  const deposit = pads * 200;
  const equipment = pads > 0 ? "Black Diamond Circuit 2.0 × " + pads : "-";
  const pickup = details.pickupPoint && details.pickupPoint !== "-"
    ? details.pickupPoint + ", Wrocław"
    : "-";
  const amount = formatMoney(details.amount, details.currency);
  const depositLabel = pads > 0 ? formatMoney(deposit, "PLN") + " - gotówką przy odbiorze" : "-";
  const rows = [
    ["Sprzęt", equipment, ""],
    ["Okres najmu", formatEmailPeriod(details), ""],
    ["Odbiór i zwrot", pickup, ""],
    ["Czynsz", amount, ""],
    ["Do zapłaty teraz", amount, "background:#fafbfc;"],
    ["Kaucja zwrotna", depositLabel, "background:#fff8e8;color:#7b5922;"]
  ];

  return '<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border:1px solid #e7e5e1;border-radius:13px;border-collapse:separate;overflow:hidden;background:#ffffff;">'
    + rows.map(function (row) {
      return '<tr style="' + row[2] + '"><td style="padding:10px 14px;border-bottom:1px solid #e7e5e1;color:#9a968e;font-size:14px;line-height:1.35;">'
        + escapeHtml(row[0]) + '</td><td style="padding:10px 14px;border-bottom:1px solid #e7e5e1;color:' + (row[2].includes("color:") ? "#7b5922" : "#1a1916") + ';font-size:' + (row[2].includes("font-size:12px") ? "12px" : "15px") + ';font-weight:700;line-height:1.35;text-align:right;word-break:break-word;">'
        + escapeHtml(row[1]) + '</td></tr>';
    }).join("")
    + "</table>";
}

function buildEmailKnowledgeHtml(details) {
  const pads = Number(details.padsCount) || 0;
  const deposit = pads > 0 ? formatMoney(pads * 200, "PLN") : "kaucja zwrotna";
  const items = [
    ["△", "Bouldering jest niebezpieczny", "Crash pad zmniejsza, ale nie eliminuje ryzyka urazu. Układaj matę płasko pod strefą lądowania, bez szczelin między matami, na terenie oczyszczonym z kamieni. Wspinaj się z asekuracją drugiej osoby.", "background:#fff8e8;border-color:#eadbb8;color:#b77920;"],
    ["▣", "Weź dokument tożsamości", "Przy odbiorze spisujemy dane z dowodu lub paszportu. Nie robimy kopii ani zdjęcia i nie zatrzymujemy dokumentu w zastaw. Musisz mieć ukończone 18 lat.", ""],
    ["$", "Kaucja " + deposit + " gotówką", "Zwracamy ją w całości od razu po oddaniu padów. Potrącamy tylko udokumentowany koszt naprawy albo brakujące elementy - zawsze z pisemnym uzasadnieniem.", ""],
    ["✓", "Normalne zużycie nic nie kosztuje", "Przetarta pokrowiec, ubita pianka, magnezja i ziemia - to jest w cenie. Płacisz tylko za realne uszkodzenie, a za zgubienie lub zniszczenie odpowiadasz zgodnie z regulaminem.", ""],
    ["◷", "Oddajesz w umówionym terminie", "Czysty i suchy, w miejscu odbioru. Za każdą rozpoczętą dobę zwłoki naliczamy czynsz. Nie odstępuj padów innym osobom i nie zostawiaj ich bez nadzoru.", ""]
  ];

  return items.map(function (item) {
    return '<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-top:8px;border:1px solid #e7e5e1;border-radius:13px;background:#ffffff;">'
      + '<tr><td style="width:38px;padding:13px 0 13px 14px;vertical-align:top;font:20px/1.1 monospace;' + item[3] + '">' + item[0] + '</td>'
      + '<td style="padding:13px 14px 13px 0;' + item[3] + '"><strong style="display:block;color:#1a1916;font-size:15px;line-height:1.3;">' + escapeHtml(item[1]) + '</strong>'
      + '<span style="display:block;margin-top:3px;color:#6b6862;font-size:14px;line-height:1.45;">' + escapeHtml(item[2]) + '</span></td></tr></table>';
  }).join("");
}

function buildPaymentEmailHtml(reservation, title, introduction) {
  const details = normalizeReservation(reservation);
  return '<!doctype html><html lang="pl"><body style="margin:0;padding:24px 12px;background:#f5f4f1;color:#1a1916;font-family:Arial,sans-serif;">'
    + '<div style="max-width:680px;margin:0 auto;background:#ffffff;border:1px solid #e7e5e1;border-radius:18px;overflow:hidden;">'
    + '<div style="padding:24px 26px;border-bottom:1px solid #e7e5e1;"><div style="font:700 11px/1.2 monospace;letter-spacing:.08em;text-transform:uppercase;color:#fb5a12;">SKUCHA · Stripe checkout</div>'
    + '<h1 style="margin:12px 0 0;font-size:30px;line-height:1.05;letter-spacing:-.02em;">' + escapeHtml(title) + '</h1>'
    + '<p style="margin:12px 0 0;color:#6b6862;font-size:16px;line-height:1.5;">' + escapeHtml(introduction) + '</p>'
    + '<div style="margin-top:14px;color:#9a968e;font:10px/1.2 monospace;letter-spacing:.06em;text-transform:uppercase;">ID rezerwacji <strong style="margin-left:5px;color:#1a1916;font-size:11px;letter-spacing:0;">' + escapeHtml(details.id) + '</strong></div></div>'
    + '<div style="padding:24px 26px;"><div style="font:700 11px/1.2 monospace;letter-spacing:.08em;text-transform:uppercase;color:#6b6862;">Twoja rezerwacja</div>'
    + '<div style="margin-top:12px;">' + buildEmailSummaryHtml(details) + '</div>'
    + '<div style="margin-top:26px;font:700 11px/1.2 monospace;letter-spacing:.08em;text-transform:uppercase;color:#6b6862;">Co musisz wiedzieć</div>'
    + buildEmailKnowledgeHtml(details)
    + '<p style="margin:18px 0 0;color:#6b6862;font:11px/1.5 monospace;">Wiadomość automatyczna z adresu rental@skucha.co.</p></div></div></body></html>';
}

function buildCancellationEmail(reservation) {
  const details = normalizeReservation(reservation);

  return [
    "Potwierdzamy anulowanie rezerwacji.",
    "",
    ...buildReservationDetails(details),
    "",
    "Wiadomosc automatyczna z adresu rental@skucha.co."
  ].join("\n");
}

function loadLegalAttachments(dependencies) {
  const files = [
    {
      name: "rental-terms-v1.0.pdf",
      contentType: "application/pdf"
    },
    {
      name: "privacy-policy-v1.0.pdf",
      contentType: "application/pdf"
    }
  ];

  return files.map(function (file) {
    const filePath = path.join(dependencies.legalDirectory, file.name);
    return {
      name: file.name,
      contentType: file.contentType,
      contentInBase64: dependencies.readFileSync(filePath).toString("base64")
    };
  });
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
    const content = {
      subject: message.subject,
      plainText: message.bodyText,
      html: message.bodyHtml || undefined
    };

    if (Array.isArray(message.attachments) && message.attachments.length) {
      content.attachments = message.attachments;
    }

    const poller = await emailClient.beginSend({
      senderAddress: senderAddress,
      content: content,
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
    const bodyHtml = buildPaymentEmailHtml(
      reservation || {},
      "Rezerwacja utworzona",
      "Aby zakończyć rezerwację, dokończ płatność przez Stripe."
    );

    return sendMessage({
      to: (reservation && reservation.email) || process.env.RESERVATION_NOTIFY_EMAIL || "rental@skucha.co",
      toName: (reservation && reservation.fullName) || "Klient",
      subject: "Skucha - rezerwacja utworzona - oczekiwanie na platnosc",
      bodyText: bodyText,
      bodyHtml: bodyHtml
    });
  }

  async function sendPaymentPendingNotification(reservation) {
    const bodyText = buildPaymentEmail(
      reservation || {},
      "Platnosc Skucha oczekuje na potwierdzenie.",
      "Checkout zostal zakonczony, ale Stripe nie potwierdzil jeszcze platnosci. Otrzymasz kolejna wiadomosc po zmianie statusu."
    );
    const bodyHtml = buildPaymentEmailHtml(
      reservation || {},
      "Płatność oczekuje na potwierdzenie",
      "Checkout został zakończony, ale Stripe nie potwierdził jeszcze płatności. Otrzymasz kolejną wiadomość po zmianie statusu."
    );

    return sendMessage({
      to: (reservation && (reservation.email || reservation.customerEmail)) || "",
      toName: (reservation && (reservation.fullName || reservation.customerName)) || "Klient",
      subject: "Skucha - platnosc oczekuje na potwierdzenie",
      bodyText: bodyText,
      bodyHtml: bodyHtml
    });
  }

  async function sendPaymentConfirmationNotification(reservation) {
    const bodyText = buildPaymentEmail(
      reservation || {},
      "Platnosc potwierdzona - rezerwacja w Skucha jest potwierdzona.",
      "Dziekujemy za platnosc. Ponizej znajdziesz komplet szczegolow rezerwacji i platnosci.",
      { includeCheckoutUrl: false }
    );
    const bodyHtml = buildPaymentEmailHtml(
      reservation || {},
      "Płatność potwierdzona",
      "Dziękujemy za płatność. Poniżej znajdziesz komplet szczegółów rezerwacji i płatności."
    );

    return sendMessage({
      to: (reservation && (reservation.email || reservation.customerEmail)) || "",
      toName: (reservation && (reservation.fullName || reservation.customerName)) || "Klient",
      subject: "Skucha - platnosc potwierdzona",
      bodyText: bodyText + "\n\nW zalacznikach: Regulamin SKUCHA oraz Polityka prywatnosci w wersji zaakceptowanej przy rezerwacji.",
      bodyHtml: bodyHtml + '<p style="margin:18px 0 0;color:#6b6862;font:12px/1.5 Arial,sans-serif;">W załącznikach: Regulamin SKUCHA oraz Polityka prywatności w wersji zaakceptowanej przy rezerwacji.</p>',
      attachments: loadLegalAttachments(dependencies)
    });
  }

  async function sendPaymentExpiredNotification(reservation) {
    const bodyText = buildPaymentEmail(
      reservation || {},
      "Sesja platnosci Skucha wygasla.",
      "Sesja checkoutu Stripe wygasla i platnosc nie zostala potwierdzona. Skontaktuj sie z nami, aby ustalic dalsze kroki."
    );
    const bodyHtml = buildPaymentEmailHtml(
      reservation || {},
      "Sesja płatności wygasła",
      "Sesja checkoutu Stripe wygasła i płatność nie została potwierdzona. Skontaktuj się z nami, aby ustalić dalsze kroki."
    );

    return sendMessage({
      to: (reservation && (reservation.email || reservation.customerEmail)) || "",
      toName: (reservation && (reservation.fullName || reservation.customerName)) || "Klient",
      subject: "Skucha - sesja platnosci wygasla",
      bodyText: bodyText,
      bodyHtml: bodyHtml
    });
  }

  async function sendCancellationNotification(reservation, cancellationResult) {
    const bodyText = buildCancellationEmail(reservation || {}, cancellationResult || {});
    const bodyHtml = buildPaymentEmailHtml(
      reservation || {},
      "Rezerwacja anulowana",
      "Potwierdzamy anulowanie rezerwacji. Szczegóły i identyfikatory znajdziesz poniżej."
    );

    return sendMessage({
      to: (reservation && reservation.customerEmail) || (reservation && reservation.email) || "",
      toName: (reservation && reservation.customerName) || "Klient",
      subject: "Skucha - anulowanie rezerwacji",
      bodyText: bodyText,
      bodyHtml: bodyHtml
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
