const Stripe = require("stripe");
const ConfigurationService = require("./ConfigurationService");

const defaultDependencies = {
  Stripe,
  ConfigurationService
};

function createConfigurationError(message, code) {
  const error = new Error(message);
  error.statusCode = 503;
  error.code = code || "PaymentNotConfigured";
  return error;
}

function createPaymentError(message, cause, code) {
  const error = new Error(message);
  error.statusCode = cause && cause.statusCode ? cause.statusCode : 502;
  error.code = code || "PaymentProviderError";
  error.details = cause && cause.message ? cause.message : undefined;
  return error;
}

function createStripeService(customDependencies) {
  const dependencies = {
    ...defaultDependencies,
    ...(customDependencies || {})
  };

  let client = null;

  function getClient() {
    if (client) {
      return client;
    }

    if (dependencies.stripeClient) {
      client = dependencies.stripeClient;
      return client;
    }

    const stripeKey = dependencies.ConfigurationService.getStripeSecretKey();

    if (!stripeKey) {
      throw createConfigurationError("Stripe secret key is not configured", "PaymentNotConfigured");
    }

    client = new dependencies.Stripe(stripeKey);
    return client;
  }

  async function createCheckoutSession(params) {
    const amountInMinorUnit = Number(params.amountInMinorUnit || 0);

    if (!Number.isInteger(amountInMinorUnit) || amountInMinorUnit < 1) {
      const validationError = new Error("Payment amount must be a positive integer in minor units");
      validationError.statusCode = 400;
      validationError.code = "InvalidPaymentAmount";
      throw validationError;
    }

    const successUrl = params.successUrl || dependencies.ConfigurationService.getStripeCheckoutSuccessUrl();
    const cancelUrl = params.cancelUrl || dependencies.ConfigurationService.getStripeCheckoutCancelUrl();

    if (!successUrl || !cancelUrl) {
      throw createConfigurationError(
        "Stripe checkout success and cancel URLs must be configured",
        "PaymentUrlsNotConfigured"
      );
    }

    const stripeClient = getClient();

    try {
      const session = await stripeClient.checkout.sessions.create({
        mode: "payment",
        success_url: successUrl,
        cancel_url: cancelUrl,
        customer_email: params.customerEmail,
        client_reference_id: params.reservationId,
        payment_method_types: ["card"],
        metadata: {
          reservationId: params.reservationId,
          customerEmail: params.customerEmail,
          dateFrom: params.dateFrom,
          dateTo: params.dateTo,
          padsCount: String(params.padsCount || "")
        },
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: String(params.currency || "pln").toLowerCase(),
              unit_amount: amountInMinorUnit,
              product_data: {
                name: params.productName || "Crash pad reservation",
                description: params.description || "Reservation payment"
              }
            }
          }
        ]
      });

      return {
        sessionId: session.id,
        url: session.url,
        paymentStatus: session.payment_status || "unpaid"
      };
    } catch (error) {
      throw createPaymentError("Unable to create Stripe checkout session", error, "PaymentProviderError");
    }
  }

  function verifyWebhookSignature(rawBody, signature) {
    const webhookSecret = dependencies.ConfigurationService.getStripeWebhookSecret();

    if (!webhookSecret) {
      throw createConfigurationError(
        "Stripe webhook secret is not configured",
        "WebhookSecretNotConfigured"
      );
    }

    const stripeClient = getClient();

    try {
      return stripeClient.webhooks.constructEvent(rawBody, signature, webhookSecret);
    } catch (error) {
      const signatureError = new Error("Webhook signature verification failed");
      signatureError.statusCode = 400;
      signatureError.code = "WebhookSignatureInvalid";
      signatureError.details = error && error.message ? error.message : undefined;
      throw signatureError;
    }
  }

  return {
    createCheckoutSession,
    verifyWebhookSignature
  };
}

let activeService = createStripeService();

function __setDependencies(overrides) {
  activeService = createStripeService(overrides);
}

function __resetDependencies() {
  activeService = createStripeService();
}

module.exports = {
  createCheckoutSession: function createCheckoutSessionProxy(params) {
    return activeService.createCheckoutSession(params);
  },
  verifyWebhookSignature: function verifyWebhookSignatureProxy(rawBody, signature) {
    return activeService.verifyWebhookSignature(rawBody, signature);
  },
  createStripeService,
  __setDependencies,
  __resetDependencies
};
