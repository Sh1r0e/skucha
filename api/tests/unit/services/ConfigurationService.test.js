const ConfigurationService = require("../../../services/ConfigurationService");

describe("ConfigurationService", function () {
  it("should_return_storage_connection_string_from_environment()", function () {
    process.env.STORAGE_CONNECTION_STRING = "UseDevelopmentStorage=true";

    const value = ConfigurationService.getStorageConnectionString();

    expect(value).toBe("UseDevelopmentStorage=true");
  });

  it("should_return_undefined_when_storage_connection_string_is_missing()", function () {
    delete process.env.STORAGE_CONNECTION_STRING;

    const value = ConfigurationService.getStorageConnectionString();

    expect(value).toBeUndefined();
  });

  it("should_return_stripe_configuration_from_environment()", function () {
    const previousSecret = process.env.STRIPE_SECRET_KEY;
    const previousSuccess = process.env.STRIPE_CHECKOUT_SUCCESS_URL;
    const previousCancel = process.env.STRIPE_CHECKOUT_CANCEL_URL;

    process.env.STRIPE_SECRET_KEY = "sk_test_123";
    process.env.STRIPE_CHECKOUT_SUCCESS_URL = "https://example.com/success";
    process.env.STRIPE_CHECKOUT_CANCEL_URL = "https://example.com/cancel";

    expect(ConfigurationService.getStripeSecretKey()).toBe("sk_test_123");
    expect(ConfigurationService.getStripeCheckoutSuccessUrl()).toBe("https://example.com/success");
    expect(ConfigurationService.getStripeCheckoutCancelUrl()).toBe("https://example.com/cancel");

    process.env.STRIPE_SECRET_KEY = previousSecret;
    process.env.STRIPE_CHECKOUT_SUCCESS_URL = previousSuccess;
    process.env.STRIPE_CHECKOUT_CANCEL_URL = previousCancel;
  });

  it("should_return_stripe_webhook_secret_from_environment()", function () {
    const previous = process.env.STRIPE_WEBHOOK_SECRET;

    process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_abc";

    expect(ConfigurationService.getStripeWebhookSecret()).toBe("whsec_test_abc");

    process.env.STRIPE_WEBHOOK_SECRET = previous;
  });
});
