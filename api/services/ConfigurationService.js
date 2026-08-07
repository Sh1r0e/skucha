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
  return process.env.ACS_SENDER_ADDRESS || "noreply@skucha.co";
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
  getReservationCancelTokenTtlHours
};
