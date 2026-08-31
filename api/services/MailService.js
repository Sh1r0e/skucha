const { EmailClient } = require("@azure/communication-email");
const fs = require("fs");
const path = require("path");
const ConfigurationService = require("./ConfigurationService");
const TimeService = require("./ReservationTimeService");

const defaultDependencies = {
  EmailClient,
  ConfigurationService,
  TimeService,
  readFileSync: fs.readFileSync,
  legalDirectory: path.join(__dirname, "..", "legal"),
  now: function now() {
    return new Date();
  }
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
    "Szczegóły rezerwacji:",
    "- ID: " + details.id,
    "- Status rezerwacji: " + details.status,
    "- Imię i nazwisko: " + details.fullName,
    "- Email: " + details.email,
    "- Telefon: " + details.phone,
    "- Termin: " + details.dateFrom + " - " + details.dateTo,
    "- Liczba padów: " + String(details.padsCount),
    "- Punkt odbioru: " + details.pickupPoint,
    "- Uwagi: " + details.notes,
    "- Kwota: " + String(details.amount) + " PLN",
    "- Kaucja zwrotna: " + formatMoney(details.padsCount === "-" ? 0 : Number(details.padsCount) * 200) + " gotówka przy odbiorze"
  ];
}

function buildPaymentDetails(reservation, options) {
  const details = normalizeReservation(reservation);
  const lines = [
    "Szczegóły płatności:",
    "- Status płatności: " + details.paymentStatus,
    "- Kwota: " + String(details.amount) + " PLN"
  ];

  if (details.checkoutUrl && (!options || options.includeCheckoutUrl !== false)) {
    lines.push("- Link do płatności: " + details.checkoutUrl);
  }

  return lines;
}

function buildCancellationDetails(reservation, options) {
  const details = normalizeReservation(reservation);

  if (!details.cancelUrl || !options || options.includeCancellation !== true) {
    return [];
  }

  return [
    "Link do anulowania rezerwacji i zwrotu:",
    details.cancelUrl,
    "Link wygasa: " + details.cancelExpiresAt
  ];
}

function buildReservationEmail(reservation, options) {
  const details = normalizeReservation(reservation);
  const lines = [
    "Rezerwacja w Skucha została utworzona.",
    "",
    "Aby zakończyć rezerwację, dokończ płatność przez Stripe.",
    "",
    ...buildReservationDetails(details),
    "",
    ...buildPaymentDetails(details),
    ""
  ];

  if (details.checkoutUrl) {
    lines.push("", "Link do checkoutu Stripe:", details.checkoutUrl);
  }

  const cancellationDetails = buildCancellationDetails(details, options);

  if (cancellationDetails.length) {
    lines.push("", ...cancellationDetails);
    lines.push("");
  }

  lines.push("Wiadomość automatyczna z adresu rental@skucha.co.");

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
  const cancellationDetails = buildCancellationDetails(reservation, options);

  if (cancellationDetails.length) {
    lines.push("", ...cancellationDetails);
  }

  lines.push("", "Wiadomość automatyczna z adresu rental@skucha.co.");
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

function formatMoney(value) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return "-";
  }

  return number.toFixed(2).replace(".", ",") + " zł";
}

function formatEmailDate(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? match[3] + "." + match[2] : String(value || "-");
}

function formatEmailSentAt(value) {
  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat("pl-PL", {
    timeZone: "Europe/Warsaw",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(date);
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

function buildEmailSummaryHtml(details, options) {
  const pads = Number(details.padsCount) || 0;
  const deposit = pads * 200;
  const equipment = pads > 0 ? "Black Diamond Circuit 2.0 × " + pads : "-";
  const pickup = details.pickupPoint && details.pickupPoint !== "-"
    ? details.pickupPoint + ", Wrocław"
    : "-";
  const amount = formatMoney(details.amount);
  const depositLabel = pads > 0 ? formatMoney(deposit) + " - gotówką przy odbiorze" : "-";
  const rows = [
    ["Sprzęt", equipment, ""],
    ["Okres najmu", formatEmailPeriod(details), ""],
    ["Odbiór i zwrot", pickup, ""],
    [(options && options.paymentLabel) || "Do zapłaty teraz", amount, "background:#fafbfc;"],
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

function buildStaffDetailsHtml(details) {
  const rows = [
    ["Klient", details.fullName],
    ["Email", details.email],
    ["Telefon", details.phone],
    ["Status rezerwacji", details.status],
    ["Status płatności", details.paymentStatus],
    ["Stripe Session ID", details.paymentSessionId],
    ["Stripe Payment Intent", details.paymentIntentId || "-"],
    ["Uwagi", details.notes]
  ];

  return '<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-top:12px;border:1px solid #e7e5e1;border-radius:13px;border-collapse:separate;overflow:hidden;background:#ffffff;">'
    + rows.map(function (row) {
      return '<tr><td style="padding:10px 14px;border-bottom:1px solid #e7e5e1;color:#9a968e;font-size:14px;line-height:1.35;">'
        + escapeHtml(row[0]) + '</td><td style="padding:10px 14px;border-bottom:1px solid #e7e5e1;color:#1a1916;font:700 13px/1.35 monospace;text-align:right;word-break:break-word;">'
        + escapeHtml(row[1]) + '</td></tr>';
    }).join("")
    + "</table>";
}

function buildEmailKnowledgeHtml(details) {
  const pads = Number(details.padsCount) || 0;
  const deposit = pads > 0 ? formatMoney(pads * 200) : "kaucja zwrotna";
  const items = [
    ["!", "Bouldering jest niebezpieczny", "Crash pad zmniejsza, ale nie eliminuje ryzyka urazu. Układaj matę płasko pod strefą lądowania, bez szczelin między matami, na terenie oczyszczonym z kamieni. Wspinaj się z asekuracją drugiej osoby.", "background:#fff8e8;border-color:#eadbb8;color:#b77920;"],
    ["ID", "Weź dokument tożsamości", "Przy odbiorze spisujemy dane z dowodu lub paszportu. Nie robimy kopii ani zdjęcia i nie zatrzymujemy dokumentu w zastaw. Musisz mieć ukończone 18 lat.", ""],
    ["PLN", "Kaucja " + deposit + " gotówką", "Zwracamy ją w całości od razu po oddaniu padów. Potrącamy tylko udokumentowany koszt naprawy albo brakujące elementy - zawsze z pisemnym uzasadnieniem.", ""],
    ["OK", "Normalne zużycie nic nie kosztuje", "Przetarty pokrowiec, ubita pianka, magnezja i ziemia - to jest w cenie. Płacisz tylko za realne uszkodzenie, a za zgubienie lub zniszczenie odpowiadasz zgodnie z regulaminem.", ""],
    ["24H", "Oddajesz w umówionym terminie", "Czysty i suchy, w miejscu odbioru. Za każdą rozpoczętą dobę zwłoki naliczamy opłatę zgodnie z regulaminem. Nie odstępuj padów innym osobom i nie zostawiaj ich bez nadzoru.", ""]
  ];

  return items.map(function (item) {
    return '<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-top:8px;border:1px solid #e7e5e1;border-radius:13px;background:#ffffff;">'
      + '<tr><td style="width:46px;padding:13px 0 13px 14px;vertical-align:top;' + item[3] + '"><span style="display:inline-block;min-width:28px;padding:5px 3px;border:1px solid #d7d3cc;border-radius:7px;background:#ffffff;color:#1a1916;font:700 10px/1 monospace;text-align:center;">' + item[0] + '</span></td>'
      + '<td style="padding:13px 14px 13px 0;' + item[3] + '"><strong style="display:block;color:#1a1916;font-size:15px;line-height:1.3;">' + escapeHtml(item[1]) + '</strong>'
      + '<span style="display:block;margin-top:3px;color:#6b6862;font-size:14px;line-height:1.45;">' + escapeHtml(item[2]) + '</span></td></tr></table>';
  }).join("");
}

function buildEmailActionsHtml(details, options) {
  const actions = [];

  if (options && options.adminUrl) {
    actions.push('<a href="' + escapeHtml(options.adminUrl) + '" style="display:inline-block;margin:0 8px 8px 0;padding:13px 18px;border-radius:10px;background:#fb5a12;color:#ffffff;font-size:15px;font-weight:700;line-height:1.2;text-decoration:none;">Otwórz panel rezerwacji</a>');
  }
  if (options && options.includeCheckoutUrl && details.checkoutUrl) {
    actions.push('<a href="' + escapeHtml(details.checkoutUrl) + '" style="display:inline-block;margin:0 8px 8px 0;padding:13px 18px;border-radius:10px;background:#fb5a12;color:#ffffff;font-size:15px;font-weight:700;line-height:1.2;text-decoration:none;">Przejdź do płatności</a>');
  }
  if (options && options.includeCancellation && details.cancelUrl) {
    actions.push('<a href="' + escapeHtml(details.cancelUrl) + '" style="display:inline-block;margin:0 8px 8px 0;padding:12px 17px;border:1px solid #d7d3cc;border-radius:10px;background:#ffffff;color:#1a1916;font-size:15px;font-weight:700;line-height:1.2;text-decoration:none;">' + escapeHtml(options.cancellationLabel || "Anuluj rezerwację") + '</a>');
  }
  actions.push('<a href="mailto:rental@skucha.co" style="display:inline-block;margin:0 0 8px;padding:12px 17px;border:1px solid #d7d3cc;border-radius:10px;background:#ffffff;color:#1a1916;font-size:15px;font-weight:700;line-height:1.2;text-decoration:none;">Skontaktuj się z nami</a>');

  return '<div style="margin-top:22px;">' + actions.join("") + '</div>';
}

function buildPaymentEmailHtml(reservation, title, introduction, options) {
  const details = normalizeReservation(reservation);
  const settings = options || {};
  const sentAt = formatEmailSentAt(settings.sentAt);
  return '<!doctype html><html lang="pl"><body style="margin:0;padding:24px 12px;background:#f5f4f1;color:#1a1916;font-family:Arial,sans-serif;">'
    + '<div style="max-width:680px;margin:0 auto;background:#ffffff;border:1px solid #e7e5e1;border-radius:18px;overflow:hidden;">'
    + '<div style="padding:24px 26px;border-bottom:1px solid #e7e5e1;"><div style="font:700 11px/1.2 monospace;letter-spacing:.08em;text-transform:uppercase;color:#fb5a12;">SKUCHA · Stripe checkout</div>'
    + '<h1 style="margin:12px 0 0;font-size:30px;line-height:1.05;letter-spacing:-.02em;">' + escapeHtml(title) + '</h1>'
    + '<p style="margin:12px 0 0;color:#6b6862;font-size:16px;line-height:1.5;">' + escapeHtml(introduction) + '</p>'
    + '<div style="margin-top:14px;color:#9a968e;font:10px/1.2 monospace;letter-spacing:.06em;text-transform:uppercase;">ID rezerwacji <strong style="margin-left:5px;color:#1a1916;font-size:11px;letter-spacing:0;">' + escapeHtml(details.id) + '</strong></div></div>'
    + '<div style="padding:24px 26px;"><div style="font:700 11px/1.2 monospace;letter-spacing:.08em;text-transform:uppercase;color:#6b6862;">Twoja rezerwacja</div>'
    + '<div style="margin-top:12px;">' + buildEmailSummaryHtml(details, settings) + '</div>'
    + (settings.includeStaffDetails ? '<div style="margin-top:26px;font:700 11px/1.2 monospace;letter-spacing:.08em;text-transform:uppercase;color:#6b6862;">Dane operacyjne</div>' + buildStaffDetailsHtml(details) : '')
    + (settings.cancellationClosedMessage ? '<p style="margin:8px 0 0;color:#6b6862;font-size:13px;line-height:1.5;">' + escapeHtml(settings.cancellationClosedMessage) + '</p>' : '')
    + (settings.includeKnowledge === false ? '' : '<div style="margin-top:26px;font:700 11px/1.2 monospace;letter-spacing:.08em;text-transform:uppercase;color:#6b6862;">Co musisz wiedzieć</div>' + buildEmailKnowledgeHtml(details))
    + (settings.attachmentNote ? '<p style="margin:18px 0 0;color:#6b6862;font-size:12px;line-height:1.5;">' + escapeHtml(settings.attachmentNote) + '</p>' : '')
    + buildEmailActionsHtml(details, settings)
    + '<p style="margin:18px 0 0;color:#6b6862;font:11px/1.5 monospace;">Wiadomość automatyczna z adresu rental@skucha.co. ' + escapeHtml(title) + '.'
    + (sentAt ? ' Wysłano: ' + escapeHtml(sentAt) + '.' : '')
    + '</p></div></div></body></html>';
}

function buildCancellationEmail(reservation) {
  const details = normalizeReservation(reservation);

  return [
    "Potwierdzamy anulowanie rezerwacji.",
    "",
    ...buildReservationDetails(details),
    "",
    "Wiadomość automatyczna z adresu rental@skucha.co."
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

  function canShowCancellationAction(reservation) {
    const details = normalizeReservation(reservation);
    if (!details.cancelUrl || !details.dateFrom) {
      return false;
    }

    const cutoffHours = typeof dependencies.ConfigurationService.getReservationCancellationCutoffHours === "function"
      ? dependencies.ConfigurationService.getReservationCancellationCutoffHours()
      : 24;
    const timezone = typeof dependencies.ConfigurationService.getReservationTimezone === "function"
      ? dependencies.ConfigurationService.getReservationTimezone()
      : "Europe/Warsaw";
    try {
      return dependencies.TimeService.isCancellationAllowed(
        details.dateFrom,
        cutoffHours,
        dependencies.now(),
        timezone
      );
    } catch (_error) {
      return false;
    }
  }

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
    const recipientAddresses = Array.isArray(message.to) ? message.to : [message.to];
    const recipientLabel = recipientAddresses.join(",");

    if (mode !== "acs-email") {
      return {
        queued: true,
        mode: mode,
        recipient: recipientLabel,
        operationId: "log-only"
      };
    }

    const senderAddress = dependencies.ConfigurationService.getAcsSenderAddress();

    if (!senderAddress) {
      throw createConfigurationError("ACS sender address is not configured", "MailSenderNotConfigured");
    }

    const emailClient = getClient();
    const content = {
      subject: message.subject
    };

    if (message.bodyHtml) {
      content.html = message.bodyHtml;
      if (!message.htmlOnly) {
        content.plainText = message.bodyText;
      }
    } else {
      content.plainText = message.bodyText;
    }

    const emailMessage = {
      senderAddress: senderAddress,
      content: content,
      recipients: {
        to: recipientAddresses.map(function (address) {
          return {
            address: address,
            displayName: message.toName || address
          };
        })
      }
    };

    if (Array.isArray(message.attachments) && message.attachments.length) {
      emailMessage.attachments = message.attachments;
    }

    const poller = await emailClient.beginSend(emailMessage);

    const response = await poller.pollUntilDone();

    return {
      queued: true,
      mode: mode,
      recipient: recipientLabel,
      operationId: response && response.id ? response.id : ""
    };
  }

  async function sendReservationNotification(reservation) {
    const includeCancellation = canShowCancellationAction(reservation || {});
    const bodyText = buildReservationEmail(reservation || {}, { includeCancellation });
    const bodyHtml = buildPaymentEmailHtml(
      reservation || {},
      "Rezerwacja utworzona",
      "Aby zakończyć rezerwację, dokończ płatność przez Stripe.",
      {
        includeCheckoutUrl: true,
        includeCancellation,
        cancellationLabel: "Anuluj rezerwację",
        sentAt: dependencies.now()
      }
    );

    return sendMessage({
      to: (reservation && reservation.email) || process.env.RESERVATION_NOTIFY_EMAIL || "rental@skucha.co",
      toName: (reservation && reservation.fullName) || "Klient",
      subject: "Skucha - rezerwacja utworzona - oczekiwanie na płatność",
      bodyText: bodyText,
      bodyHtml: bodyHtml
    });
  }

  async function sendPaymentPendingNotification(reservation) {
    const includeCancellation = canShowCancellationAction(reservation || {});
    const bodyText = buildPaymentEmail(
      reservation || {},
      "Płatność Skucha oczekuje na potwierdzenie.",
      "Checkout został zakończony, ale Stripe nie potwierdził jeszcze płatności. Otrzymasz kolejną wiadomość po zmianie statusu.",
      { includeCancellation }
    );
    const bodyHtml = buildPaymentEmailHtml(
      reservation || {},
      "Płatność oczekuje na potwierdzenie",
      "Checkout został zakończony, ale Stripe nie potwierdził jeszcze płatności. Otrzymasz kolejną wiadomość po zmianie statusu.",
      {
        includeCancellation,
        cancellationLabel: "Anuluj rezerwację",
        paymentLabel: "Kwota płatności"
      }
    );

    return sendMessage({
      to: (reservation && (reservation.email || reservation.customerEmail)) || "",
      toName: (reservation && (reservation.fullName || reservation.customerName)) || "Klient",
      subject: "Skucha - płatność oczekuje na potwierdzenie",
      bodyText: bodyText,
      bodyHtml: bodyHtml
    });
  }

  async function sendPaymentConfirmationNotification(reservation) {
    const includeCancellation = canShowCancellationAction(reservation || {});
    const bodyText = buildPaymentEmail(
      reservation || {},
      "Płatność potwierdzona - rezerwacja w Skucha jest potwierdzona.",
      "Dziękujemy za płatność. Poniżej znajdziesz komplet szczegółów rezerwacji i płatności.",
      { includeCheckoutUrl: false, includeCancellation }
    );
    const bodyHtml = buildPaymentEmailHtml(
      reservation || {},
      "Płatność potwierdzona",
      "Dziękujemy za płatność. Twoja rezerwacja jest potwierdzona.",
      {
        includeCancellation,
        cancellationLabel: "Anuluj rezerwację i poproś o zwrot",
        paymentLabel: "Zapłacono",
        cancellationClosedMessage: includeCancellation
          ? "Bezpłatne anulowanie ze zwrotem jest dostępne do 24 godzin przed rozpoczęciem najmu."
          : "Termin bezpłatnego anulowania ze zwrotem minął. W razie pytań skontaktuj się z nami.",
        attachmentNote: "W załącznikach znajdziesz Regulamin SKUCHA oraz Politykę prywatności w wersji zaakceptowanej przy rezerwacji.",
        sentAt: dependencies.now()
      }
    );

    const customerResult = await sendMessage({
      to: (reservation && (reservation.email || reservation.customerEmail)) || "",
      toName: (reservation && (reservation.fullName || reservation.customerName)) || "Klient",
      subject: "Skucha - płatność potwierdzona",
      bodyText: bodyText + "\n\nW załącznikach: Regulamin SKUCHA oraz Polityka prywatności w wersji zaakceptowanej przy rezerwacji.",
      bodyHtml: bodyHtml,
      htmlOnly: true,
      attachments: loadLegalAttachments(dependencies)
    });

    const details = normalizeReservation(reservation || {});
    const staffRecipients = typeof dependencies.ConfigurationService.getPaidReservationNotificationRecipients === "function"
      ? dependencies.ConfigurationService.getPaidReservationNotificationRecipients()
      : ["kubagrech@gmail.com", "kacperbednarz@icloud.com"];
    const publicBaseUrl = typeof dependencies.ConfigurationService.getReservationPublicBaseUrl === "function"
      ? dependencies.ConfigurationService.getReservationPublicBaseUrl()
      : "https://www.skucha.co";
    const staffResult = await sendMessage({
      to: staffRecipients,
      toName: "SKUCHA - obsługa rezerwacji",
      subject: "SKUCHA - opłacona rezerwacja " + details.id,
      bodyText: buildPaymentEmail(
        reservation || {},
        "Nowa opłacona rezerwacja.",
        "Płatność została potwierdzona. Rezerwacja jest gotowa do obsługi w panelu administracyjnym.",
        { includeCheckoutUrl: false }
      ) + "\n- Stripe Session ID: " + details.paymentSessionId
        + "\n- Stripe Payment Intent: " + (details.paymentIntentId || "-"),
      bodyHtml: buildPaymentEmailHtml(
        reservation || {},
        "Nowa opłacona rezerwacja",
        "Płatność została potwierdzona. Rezerwacja jest gotowa do obsługi w panelu administracyjnym.",
        {
          paymentLabel: "Zapłacono",
          includeKnowledge: false,
          includeStaffDetails: true,
          adminUrl: String(publicBaseUrl || "https://www.skucha.co").replace(/\/$/, "") + "/admin/reservations.html",
          sentAt: dependencies.now()
        }
      )
    });

    return {
      ...customerResult,
      staffNotification: staffResult
    };
  }

  async function sendPaymentExpiredNotification(reservation) {
    const bodyText = buildPaymentEmail(
      reservation || {},
      "Sesja płatności Skucha wygasła.",
      "Sesja checkoutu Stripe wygasła i płatność nie została potwierdzona. Skontaktuj się z nami, aby ustalić dalsze kroki."
    );
    const bodyHtml = buildPaymentEmailHtml(
      reservation || {},
      "Sesja płatności wygasła",
      "Sesja checkoutu Stripe wygasła i płatność nie została potwierdzona. Skontaktuj się z nami, aby ustalić dalsze kroki.",
      { paymentLabel: "Kwota płatności" }
    );

    return sendMessage({
      to: (reservation && (reservation.email || reservation.customerEmail)) || "",
      toName: (reservation && (reservation.fullName || reservation.customerName)) || "Klient",
      subject: "Skucha - sesja płatności wygasła",
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
