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

module.exports = {
  getStorageConnectionString,
  getStripeSecretKey,
  getStripeCheckoutSuccessUrl,
  getStripeCheckoutCancelUrl,
  getStripeWebhookSecret
};
