const TurnstileService = require("../../../services/TurnstileService");

function configuration(secret) {
  return {
    getTurnstileSecretKey: vi.fn().mockReturnValue(secret),
    getReservationPublicBaseUrl: vi.fn().mockReturnValue("https://www.skucha.co")
  };
}

describe("TurnstileService", function () {
  it("should_validate_the_token_action_and_hostname_without_proxy_address", async function () {
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ success: true, action: "reservation", hostname: "www.skucha.co" })
    });
    const service = TurnstileService.createTurnstileService({
      ConfigurationService: configuration("turnstile-secret"),
      fetch
    });

    await expect(service.verifyReservation("valid-token", { headers: {} })).resolves.toEqual({ success: true });
    expect(fetch).toHaveBeenCalledWith(TurnstileService.SITEVERIFY_URL, expect.objectContaining({
      method: "POST",
      body: expect.not.stringContaining("remoteip=")
    }));
  });

  it("should_reject_missing_invalid_or_context-mismatched_tokens", async function () {
    const failedFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ success: false, "error-codes": ["invalid-input-response"] })
    });
    const failed = TurnstileService.createTurnstileService({
      ConfigurationService: configuration("turnstile-secret"),
      fetch: failedFetch,
      getClientAddress: vi.fn().mockReturnValue("unknown")
    });
    const wrongAction = TurnstileService.createTurnstileService({
      ConfigurationService: configuration("turnstile-secret"),
      fetch: vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ success: true, action: "login", hostname: "www.skucha.co" })
      }),
      getClientAddress: vi.fn().mockReturnValue("unknown")
    });

    await expect(failed.verifyReservation("", {})).rejects.toMatchObject({ statusCode: 400, code: "BotVerificationFailed" });
    await expect(failed.verifyReservation("a".repeat(2049), {})).rejects.toMatchObject({ statusCode: 400, code: "BotVerificationFailed" });
    await expect(failed.verifyReservation("invalid", {})).rejects.toMatchObject({
      statusCode: 400,
      code: "BotVerificationFailed",
      details: { reason: "siteverify-rejected", errorCodes: ["invalid-input-response"] }
    });
    await expect(wrongAction.verifyReservation("valid", {})).rejects.toMatchObject({
      statusCode: 400,
      code: "BotVerificationFailed",
      details: { reason: "action-mismatch", receivedAction: "login" }
    });
    expect(failedFetch.mock.calls[0][1].body).not.toContain("remoteip");
  });

  it("should_fail_closed_when_siteverify_is_unavailable", async function () {
    const networkFailure = TurnstileService.createTurnstileService({
      ConfigurationService: configuration("turnstile-secret"),
      fetch: vi.fn().mockRejectedValue(new Error("network")),
      getClientAddress: vi.fn().mockReturnValue("unknown")
    });
    const upstreamFailure = TurnstileService.createTurnstileService({
      ConfigurationService: configuration("turnstile-secret"),
      fetch: vi.fn().mockResolvedValue({ ok: false }),
      getClientAddress: vi.fn().mockReturnValue("unknown")
    });

    await expect(networkFailure.verifyReservation("token", {}))
      .rejects.toMatchObject({ statusCode: 503, code: "BotVerificationUnavailable" });
    await expect(upstreamFailure.verifyReservation("token", {}))
      .rejects.toMatchObject({ statusCode: 503, code: "BotVerificationUnavailable" });
  });

  it("should_identify_an_invalid_siteverify_secret_as_configuration_failure", async function () {
    const service = TurnstileService.createTurnstileService({
      ConfigurationService: configuration("wrong-secret"),
      fetch: vi.fn().mockResolvedValue({
        ok: false,
        json: vi.fn().mockResolvedValue({ success: false, "error-codes": ["invalid-input-secret"] })
      })
    });

    await expect(service.verifyReservation("token", {}))
      .rejects.toMatchObject({ statusCode: 503, code: "BotVerificationNotConfigured" });
  });

  it("should_fail_closed_for_missing_production_or_invalid_host_configuration", async function () {
    const previousEnvironment = process.env.SKUCHA_ENV;
    process.env.SKUCHA_ENV = "production";
    try {
      const missingSecret = TurnstileService.createTurnstileService({
        ConfigurationService: configuration("")
      });
      await expect(missingSecret.verifyReservation("", {}))
        .rejects.toMatchObject({ statusCode: 503, code: "BotVerificationNotConfigured" });
    } finally {
      if (previousEnvironment === undefined) {
        delete process.env.SKUCHA_ENV;
      } else {
        process.env.SKUCHA_ENV = previousEnvironment;
      }
    }

    const invalidHostConfiguration = configuration("turnstile-secret");
    invalidHostConfiguration.getReservationPublicBaseUrl.mockReturnValue("not a URL");
    const invalidHost = TurnstileService.createTurnstileService({
      ConfigurationService: invalidHostConfiguration
    });
    await expect(invalidHost.verifyReservation("token", {}))
      .rejects.toMatchObject({ statusCode: 503, code: "BotVerificationNotConfigured" });
  });

  it("should_skip_an_unconfigured_widget_outside_production", async function () {
    const service = TurnstileService.createTurnstileService({
      ConfigurationService: configuration("")
    });

    await expect(service.verifyReservation("", {})).resolves.toEqual({ success: true, skipped: true });
  });

  it("should_skip_verification_for_preview_deployments_even_when_configured", async function () {
    const previousDeploymentEnvironment = process.env.SKUCHA_DEPLOYMENT_ENV;
    const previousEnvironment = process.env.SKUCHA_ENV;
    const fetch = vi.fn();
    process.env.SKUCHA_DEPLOYMENT_ENV = "preview";
    process.env.SKUCHA_ENV = "production";

    try {
      const service = TurnstileService.createTurnstileService({
        ConfigurationService: configuration("turnstile-secret"),
        fetch
      });

      await expect(service.verifyReservation("", {}))
        .resolves.toEqual({ success: true, skipped: true });
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      if (previousDeploymentEnvironment === undefined) {
        delete process.env.SKUCHA_DEPLOYMENT_ENV;
      } else {
        process.env.SKUCHA_DEPLOYMENT_ENV = previousDeploymentEnvironment;
      }
      if (previousEnvironment === undefined) {
        delete process.env.SKUCHA_ENV;
      } else {
        process.env.SKUCHA_ENV = previousEnvironment;
      }
    }
  });
});