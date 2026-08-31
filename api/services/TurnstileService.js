const ConfigurationService = require("./ConfigurationService");

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const MAX_TOKEN_LENGTH = 2048;
const VERIFY_TIMEOUT_MS = 8000;

const defaultDependencies = {
  ConfigurationService,
  fetch: global.fetch
};

function verificationError(message, statusCode, code) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function isProduction() {
  return process.env.NODE_ENV === "production" || process.env.SKUCHA_ENV === "production";
}

function isPreviewDeployment() {
  return process.env.SKUCHA_DEPLOYMENT_ENV === "preview";
}

function createTurnstileService(customDependencies) {
  const dependencies = {
    ...defaultDependencies,
    ...(customDependencies || {})
  };

  async function verifyReservation(token, _request) {
    if (isPreviewDeployment()) {
      return { success: true, skipped: true };
    }

    const secret = typeof dependencies.ConfigurationService.getTurnstileSecretKey === "function"
      ? dependencies.ConfigurationService.getTurnstileSecretKey()
      : "";
    if (!secret) {
      if (isProduction()) {
        throw verificationError("Bot verification is not configured", 503, "BotVerificationNotConfigured");
      }
      return { success: true, skipped: true };
    }

    const normalizedToken = String(token || "").trim();
    if (!normalizedToken || normalizedToken.length > MAX_TOKEN_LENGTH) {
      throw verificationError("Complete the bot verification and try again", 400, "BotVerificationFailed");
    }

    const publicBaseUrl = dependencies.ConfigurationService.getReservationPublicBaseUrl();
    let expectedHostname = "";
    try {
      expectedHostname = new URL(publicBaseUrl).hostname;
    } catch (_error) {
      throw verificationError("Bot verification is not configured", 503, "BotVerificationNotConfigured");
    }

    const body = new global.URLSearchParams({
      secret,
      response: normalizedToken
    });
    const controller = new global.AbortController();
    const timeout = global.setTimeout(function () {
      controller.abort();
    }, VERIFY_TIMEOUT_MS);

    let result;
    try {
      const response = await dependencies.fetch(SITEVERIFY_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
        signal: controller.signal
      });
      result = await response.json();
      if (!response.ok) {
        const errorCodes = Array.isArray(result && result["error-codes"])
          ? result["error-codes"]
          : [];
        if (errorCodes.includes("missing-input-secret") || errorCodes.includes("invalid-input-secret")) {
          throw verificationError("Bot verification is not configured", 503, "BotVerificationNotConfigured");
        }
        throw verificationError("Bot verification is temporarily unavailable", 503, "BotVerificationUnavailable");
      }
    } catch (error) {
      if (error && error.statusCode) {
        throw error;
      }
      throw verificationError("Bot verification is temporarily unavailable", 503, "BotVerificationUnavailable");
    } finally {
      global.clearTimeout(timeout);
    }

    if (!result || result.success !== true
      || result.action !== "reservation"
      || String(result.hostname || "").toLowerCase() !== expectedHostname.toLowerCase()) {
      throw verificationError("Complete the bot verification and try again", 400, "BotVerificationFailed");
    }

    return { success: true };
  }

  return { verifyReservation };
}

let activeService = createTurnstileService();

module.exports = {
  SITEVERIFY_URL,
  verifyReservation: function verifyReservationProxy(token, request) {
    return activeService.verifyReservation(token, request);
  },
  createTurnstileService,
  __setDependencies: function __setDependencies(overrides) {
    activeService = createTurnstileService(overrides);
  },
  __resetDependencies: function __resetDependencies() {
    activeService = createTurnstileService();
  }
};