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

function getRateLimitHashSecret() {
  return process.env.RATE_LIMIT_HASH_SECRET || "";
}

function getTurnstileSecretKey() {
  return process.env.TURNSTILE_SECRET_KEY || "";
}

function getMailMode() {
  return String(process.env.MAIL_MODE || "log-only").trim().toLowerCase();
}

function isStrongSecret(value) {
  return typeof value === "string"
    && value.length >= 32
    && /^[\x21-\x7e]+$/.test(value);
}

function parseHttpsUrl(value) {
  try {
    const parsed = new URL(String(value || ""));
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.hash) {
      return null;
    }
    return parsed;
  } catch (_error) {
    return null;
  }
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
  if (!getRateLimitHashSecret()) {
    issues.push("RATE_LIMIT_HASH_SECRET");
  }
  if (!getTurnstileSecretKey()) {
    issues.push("TURNSTILE_SECRET_KEY");
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

  if (production) {
    const publicBaseUrl = parseHttpsUrl(process.env.RESERVATION_PUBLIC_BASE_URL);
    const successUrl = parseHttpsUrl(getStripeCheckoutSuccessUrl());
    const cancelUrl = parseHttpsUrl(getStripeCheckoutCancelUrl());

    if (!process.env.RESERVATION_PUBLIC_BASE_URL) {
      issues.push("RESERVATION_PUBLIC_BASE_URL");
    } else if (!publicBaseUrl) {
      issues.push("RESERVATION_PUBLIC_BASE_URL_INVALID");
    }

    if (getStripeSecretKey() && !String(getStripeSecretKey()).startsWith("sk_live_")) {
      issues.push("STRIPE_SECRET_KEY_NOT_LIVE");
    }

    if (getStripeWebhookSecret() && !String(getStripeWebhookSecret()).startsWith("whsec_")) {
      issues.push("STRIPE_WEBHOOK_SECRET_INVALID");
    }

    if (getStripeCheckoutSuccessUrl() && !successUrl) {
      issues.push("STRIPE_CHECKOUT_SUCCESS_URL_INVALID");
    }

    if (getStripeCheckoutCancelUrl() && !cancelUrl) {
      issues.push("STRIPE_CHECKOUT_CANCEL_URL_INVALID");
    }

    if (successUrl && !String(getStripeCheckoutSuccessUrl()).includes("{CHECKOUT_SESSION_ID}")) {
      issues.push("STRIPE_CHECKOUT_SUCCESS_URL_MISSING_SESSION_ID");
    }

    if (cancelUrl && !String(getStripeCheckoutCancelUrl()).includes("{CHECKOUT_SESSION_ID}")) {
      issues.push("STRIPE_CHECKOUT_CANCEL_URL_MISSING_SESSION_ID");
    }

    if (publicBaseUrl && successUrl && publicBaseUrl.origin !== successUrl.origin) {
      issues.push("STRIPE_CHECKOUT_SUCCESS_URL_ORIGIN_MISMATCH");
    }

    if (publicBaseUrl && cancelUrl && publicBaseUrl.origin !== cancelUrl.origin) {
      issues.push("STRIPE_CHECKOUT_CANCEL_URL_ORIGIN_MISMATCH");
    }

    const cancellationSecret = getReservationCancelTokenSecret();
    const housekeepingSecret = getHousekeepingSecret();
    const rateLimitSecret = getRateLimitHashSecret();
    const turnstileSecret = getTurnstileSecretKey();

    if (cancellationSecret && !isStrongSecret(cancellationSecret)) {
      issues.push("RESERVATION_CANCEL_TOKEN_SECRET_WEAK");
    }

    if (housekeepingSecret && !isStrongSecret(housekeepingSecret)) {
      issues.push("HOUSEKEEPING_SECRET_WEAK");
    }

    if (rateLimitSecret && !isStrongSecret(rateLimitSecret)) {
      issues.push("RATE_LIMIT_HASH_SECRET_WEAK");
    }

    if (turnstileSecret && !isStrongSecret(turnstileSecret)) {
      issues.push("TURNSTILE_SECRET_KEY_WEAK");
    }

    if (cancellationSecret && housekeepingSecret && cancellationSecret === housekeepingSecret) {
      issues.push("OPERATIONAL_SECRETS_MUST_DIFFER");
    }

    const operationalSecrets = [
      cancellationSecret,
      housekeepingSecret,
      rateLimitSecret,
      turnstileSecret
    ].filter(Boolean);
    if (new Set(operationalSecrets).size !== operationalSecrets.length
      && !issues.includes("OPERATIONAL_SECRETS_MUST_DIFFER")) {
      issues.push("OPERATIONAL_SECRETS_MUST_DIFFER");
    }
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
  getRateLimitHashSecret,
  getTurnstileSecretKey,
  getMailMode,
  getRuntimeConfigurationIssues
};
