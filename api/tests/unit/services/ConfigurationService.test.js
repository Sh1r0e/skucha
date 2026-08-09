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

  it("should_report_missing_production_configuration_without_exposing_values()", function () {
    const previous = {
      storage: process.env.STORAGE_CONNECTION_STRING,
      stripe: process.env.STRIPE_SECRET_KEY,
      success: process.env.STRIPE_CHECKOUT_SUCCESS_URL,
      cancel: process.env.STRIPE_CHECKOUT_CANCEL_URL,
      webhook: process.env.STRIPE_WEBHOOK_SECRET,
      cancellation: process.env.RESERVATION_CANCEL_TOKEN_SECRET,
      housekeeping: process.env.HOUSEKEEPING_SECRET,
      mailMode: process.env.MAIL_MODE
    };

    try {
      [
        "STORAGE_CONNECTION_STRING",
        "STRIPE_SECRET_KEY",
        "STRIPE_CHECKOUT_SUCCESS_URL",
        "STRIPE_CHECKOUT_CANCEL_URL",
        "STRIPE_WEBHOOK_SECRET",
        "RESERVATION_CANCEL_TOKEN_SECRET",
        "HOUSEKEEPING_SECRET"
      ].forEach(function (name) { delete process.env[name]; });
      process.env.MAIL_MODE = "log-only";

      const issues = ConfigurationService.getRuntimeConfigurationIssues({ production: true });

      expect(issues).toContain("STORAGE_CONNECTION_STRING");
      expect(issues).toContain("MAIL_MODE=acs-email");
      expect(issues.join(" ")).not.toContain("sk_");
    } finally {
      Object.keys({
        STORAGE_CONNECTION_STRING: previous.storage,
        STRIPE_SECRET_KEY: previous.stripe,
        STRIPE_CHECKOUT_SUCCESS_URL: previous.success,
        STRIPE_CHECKOUT_CANCEL_URL: previous.cancel,
        STRIPE_WEBHOOK_SECRET: previous.webhook,
        RESERVATION_CANCEL_TOKEN_SECRET: previous.cancellation,
        HOUSEKEEPING_SECRET: previous.housekeeping,
        MAIL_MODE: previous.mailMode
      }).forEach(function (name) {
        const value = {
          STORAGE_CONNECTION_STRING: previous.storage,
          STRIPE_SECRET_KEY: previous.stripe,
          STRIPE_CHECKOUT_SUCCESS_URL: previous.success,
          STRIPE_CHECKOUT_CANCEL_URL: previous.cancel,
          STRIPE_WEBHOOK_SECRET: previous.webhook,
          RESERVATION_CANCEL_TOKEN_SECRET: previous.cancellation,
          HOUSEKEEPING_SECRET: previous.housekeeping,
          MAIL_MODE: previous.mailMode
        }[name];
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      });
    }
  });

  it("should_accept_complete_production_configuration_and_normalize_settings()", function () {
    const previous = { ...process.env };

    try {
      process.env.STORAGE_CONNECTION_STRING = "storage";
      process.env.STRIPE_SECRET_KEY = "stripe";
      process.env.STRIPE_CHECKOUT_SUCCESS_URL = "https://example.com/success";
      process.env.STRIPE_CHECKOUT_CANCEL_URL = "https://example.com/cancel";
      process.env.STRIPE_WEBHOOK_SECRET = "webhook";
      process.env.RESERVATION_CANCEL_TOKEN_SECRET = "cancel";
      process.env.HOUSEKEEPING_SECRET = "housekeeping";
      process.env.MAIL_MODE = " ACS-EMAIL ";
      process.env.ACS_CONNECTION_STRING = "acs";
      process.env.RESERVATION_CANCELLATION_CUTOFF_HOURS = "invalid";
      process.env.RESERVATION_PENDING_EXPIRY_HOURS = "invalid";
      process.env.INVENTORY_LEASE_TTL_MS = "1";

      expect(ConfigurationService.getRuntimeConfigurationIssues({ production: true })).toEqual([]);
      expect(ConfigurationService.getMailMode()).toBe("acs-email");
      expect(ConfigurationService.getReservationCancellationCutoffHours()).toBe(24);
      expect(ConfigurationService.getReservationPendingExpiryHours()).toBe(2);
      expect(ConfigurationService.getInventoryLeaseTtlMs()).toBe(30000);
    } finally {
      Object.keys(process.env).forEach(function (name) {
        if (!(name in previous)) delete process.env[name];
      });
      Object.keys(previous).forEach(function (name) { process.env[name] = previous[name]; });
    }
  });

  it("should_return_configured_optional_values_and_safe_numeric_defaults()", function () {
    const previous = {
      baseUrl: process.env.RESERVATION_PUBLIC_BASE_URL,
      ttl: process.env.RESERVATION_CANCEL_TOKEN_TTL_HOURS,
      cutoff: process.env.RESERVATION_CANCELLATION_CUTOFF_HOURS,
      pending: process.env.RESERVATION_PENDING_EXPIRY_HOURS,
      timezone: process.env.RESERVATION_TIMEZONE,
      housekeeping: process.env.HOUSEKEEPING_SECRET,
      lease: process.env.INVENTORY_LEASE_TTL_MS,
      sender: process.env.ACS_SENDER_ADDRESS,
      mail: process.env.MAIL_MODE
    };

    try {
      process.env.RESERVATION_PUBLIC_BASE_URL = "https://custom.example";
      process.env.RESERVATION_CANCEL_TOKEN_TTL_HOURS = "24";
      process.env.RESERVATION_CANCELLATION_CUTOFF_HOURS = "0";
      process.env.RESERVATION_PENDING_EXPIRY_HOURS = "4";
      process.env.RESERVATION_TIMEZONE = "UTC";
      process.env.HOUSEKEEPING_SECRET = "secret";
      process.env.INVENTORY_LEASE_TTL_MS = "60000";
      process.env.ACS_SENDER_ADDRESS = "sender@example.com";
      process.env.MAIL_MODE = "LOG-ONLY";

      expect(ConfigurationService.getReservationPublicBaseUrl()).toBe("https://custom.example");
      expect(ConfigurationService.getReservationCancelTokenTtlHours()).toBe(24);
      expect(ConfigurationService.getReservationCancellationCutoffHours()).toBe(0);
      expect(ConfigurationService.getReservationPendingExpiryHours()).toBe(4);
      expect(ConfigurationService.getReservationTimezone()).toBe("UTC");
      expect(ConfigurationService.getHousekeepingSecret()).toBe("secret");
      expect(ConfigurationService.getInventoryLeaseTtlMs()).toBe(60000);
      expect(ConfigurationService.getAcsSenderAddress()).toBe("sender@example.com");
      expect(ConfigurationService.getMailMode()).toBe("log-only");
    } finally {
      const values = {
        RESERVATION_PUBLIC_BASE_URL: previous.baseUrl,
        RESERVATION_CANCEL_TOKEN_TTL_HOURS: previous.ttl,
        RESERVATION_CANCELLATION_CUTOFF_HOURS: previous.cutoff,
        RESERVATION_PENDING_EXPIRY_HOURS: previous.pending,
        RESERVATION_TIMEZONE: previous.timezone,
        HOUSEKEEPING_SECRET: previous.housekeeping,
        INVENTORY_LEASE_TTL_MS: previous.lease,
        ACS_SENDER_ADDRESS: previous.sender,
        MAIL_MODE: previous.mail
      };
      Object.keys(values).forEach(function (name) {
        if (values[name] === undefined) delete process.env[name];
        else process.env[name] = values[name];
      });
    }
  });
});
