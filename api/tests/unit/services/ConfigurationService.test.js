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

  it("should_return_acs_configuration_with_defaults()", function () {
    const previousConnection = process.env.ACS_CONNECTION_STRING;
    const previousSender = process.env.ACS_SENDER_ADDRESS;

    process.env.ACS_CONNECTION_STRING = "endpoint=https://example";
    delete process.env.ACS_SENDER_ADDRESS;

    expect(ConfigurationService.getAcsConnectionString()).toBe("endpoint=https://example");
    expect(ConfigurationService.getAcsSenderAddress()).toBe("noreply@skucha.co");

    process.env.ACS_CONNECTION_STRING = previousConnection;
    process.env.ACS_SENDER_ADDRESS = previousSender;
  });

  it("should_return_cancellation_link_settings_from_environment()", function () {
    const prevBaseUrl = process.env.RESERVATION_PUBLIC_BASE_URL;
    const prevSecret = process.env.RESERVATION_CANCEL_TOKEN_SECRET;
    const prevTtl = process.env.RESERVATION_CANCEL_TOKEN_TTL_HOURS;

    process.env.RESERVATION_PUBLIC_BASE_URL = "https://demo.skucha.co";
    process.env.RESERVATION_CANCEL_TOKEN_SECRET = "top-secret";
    process.env.RESERVATION_CANCEL_TOKEN_TTL_HOURS = "24";

    expect(ConfigurationService.getReservationPublicBaseUrl()).toBe("https://demo.skucha.co");
    expect(ConfigurationService.getReservationCancelTokenSecret()).toBe("top-secret");
    expect(ConfigurationService.getReservationCancelTokenTtlHours()).toBe(24);

    process.env.RESERVATION_PUBLIC_BASE_URL = prevBaseUrl;
    process.env.RESERVATION_CANCEL_TOKEN_SECRET = prevSecret;
    process.env.RESERVATION_CANCEL_TOKEN_TTL_HOURS = prevTtl;
  });

  it("should_enable_maintenance_mode_for_truthy_environment_values()", function () {
    const previous = process.env.MAINTENANCE_MODE;

    try {
      ["1", "true", "yes", "on", " TRUE "].forEach(function (value) {
        process.env.MAINTENANCE_MODE = value;
        expect(ConfigurationService.getMaintenanceMode()).toBe(true);
      });
    } finally {
      if (previous === undefined) {
        delete process.env.MAINTENANCE_MODE;
      } else {
        process.env.MAINTENANCE_MODE = previous;
      }
    }
  });

  it("should_disable_maintenance_mode_when_environment_value_is_not_truthy()", function () {
    const previous = process.env.MAINTENANCE_MODE;

    try {
      process.env.MAINTENANCE_MODE = "false";
      expect(ConfigurationService.getMaintenanceMode()).toBe(false);

      delete process.env.MAINTENANCE_MODE;
      expect(ConfigurationService.getMaintenanceMode()).toBe(false);
    } finally {
      if (previous === undefined) {
        delete process.env.MAINTENANCE_MODE;
      } else {
        process.env.MAINTENANCE_MODE = previous;
      }
    }
  });
});
