function getStorageConnectionString() {
  return process.env.STORAGE_CONNECTION_STRING;
}

function getStripeSecretKey() {
  return process.env.STRIPE_SECRET_KEY;
}

function getStripeCheckoutSuccessUrl() {
  return process.env.STRIPE_CHECKOUT_SUCCESS_URL;
}

function getStripeCheckoutCancelUrl() {
  return process.env.STRIPE_CHECKOUT_CANCEL_URL;
}

function getStripeWebhookSecret() {
  return process.env.STRIPE_WEBHOOK_SECRET;
}

function getAcsConnectionString() {
  return process.env.ACS_CONNECTION_STRING;
}

function getAcsSenderAddress() {
  return process.env.ACS_SENDER_ADDRESS || "rental@skucha.co";
}

function getReservationPublicBaseUrl() {
  return process.env.RESERVATION_PUBLIC_BASE_URL || "https://www.skucha.co";
}

function getReservationCancelTokenSecret() {
  return process.env.RESERVATION_CANCEL_TOKEN_SECRET;
}

function getReservationCancelTokenTtlHours() {
  const raw = Number(process.env.RESERVATION_CANCEL_TOKEN_TTL_HOURS || 72);
  return Number.isFinite(raw) && raw > 0 ? raw : 72;
}

function getMaintenanceMode() {
  return ["1", "true", "yes", "on"].includes(
    String(process.env.MAINTENANCE_MODE || "").trim().toLowerCase()
  );
}

function getReservationCancellationCutoffHours() {
  const raw = Number(process.env.RESERVATION_CANCELLATION_CUTOFF_HOURS || 24);
  return Number.isFinite(raw) && raw >= 0 ? raw : 24;
}

function getReservationPendingExpiryHours() {
  const raw = Number(process.env.RESERVATION_PENDING_EXPIRY_HOURS || 2);
  return Number.isFinite(raw) && raw > 0 ? raw : 2;
}

function getReservationTimezone() {
  return process.env.RESERVATION_TIMEZONE || "Europe/Warsaw";
}

function getHousekeepingSecret() {
  return process.env.HOUSEKEEPING_SECRET || "";
}

function getInventoryLeaseTtlMs() {
  const raw = Number(process.env.INVENTORY_LEASE_TTL_MS || 30000);
  return Number.isFinite(raw) && raw >= 5000 ? raw : 30000;
}

function getMailMode() {
  return String(process.env.MAIL_MODE || "log-only").trim().toLowerCase();
}

function getRuntimeConfigurationIssues(options) {
  const settings = options || {};
  const production = settings.production === true;
  const issues = [];

  if (!getStorageConnectionString()) {
    issues.push("STORAGE_CONNECTION_STRING");
  }
  if (!getStripeSecretKey()) {
    issues.push("STRIPE_SECRET_KEY");
  }
  if (!getStripeCheckoutSuccessUrl()) {
    issues.push("STRIPE_CHECKOUT_SUCCESS_URL");
  }
  if (!getStripeCheckoutCancelUrl()) {
    issues.push("STRIPE_CHECKOUT_CANCEL_URL");
  }
  if (!getStripeWebhookSecret()) {
    issues.push("STRIPE_WEBHOOK_SECRET");
  }
  if (!getReservationCancelTokenSecret()) {
    issues.push("RESERVATION_CANCEL_TOKEN_SECRET");
  }
  if (!getHousekeepingSecret()) {
    issues.push("HOUSEKEEPING_SECRET");
  }
  if (production && getMailMode() !== "acs-email") {
    issues.push("MAIL_MODE=acs-email");
  }
  if (getMailMode() === "acs-email" && !getAcsConnectionString()) {
    issues.push("ACS_CONNECTION_STRING");
  }
  if (getMailMode() === "acs-email" && !getAcsSenderAddress()) {
    issues.push("ACS_SENDER_ADDRESS");
  }

  return issues;
}

module.exports = {
  getStorageConnectionString,
  getStripeSecretKey,
  getStripeCheckoutSuccessUrl,
  getStripeCheckoutCancelUrl,
  getStripeWebhookSecret,
  getAcsConnectionString,
  getAcsSenderAddress,
  getReservationPublicBaseUrl,
  getReservationCancelTokenSecret,
  getReservationCancelTokenTtlHours,
  getMaintenanceMode,
  getReservationCancellationCutoffHours,
  getReservationPendingExpiryHours,
  getReservationTimezone,
  getHousekeepingSecret,
  getInventoryLeaseTtlMs,
  getMailMode,
  getRuntimeConfigurationIssues
};
