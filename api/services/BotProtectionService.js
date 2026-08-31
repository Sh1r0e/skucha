const crypto = require("crypto");
const net = require("net");
const RateLimitRepository = require("../repositories/RateLimitRepository");
const ConfigurationService = require("./ConfigurationService");
const { getHeader } = require("../helpers/http");

const POLICIES = Object.freeze({
  availability: Object.freeze({ limit: 120, windowSeconds: 60 }),
  "reservation-create": Object.freeze({ limit: 10, windowSeconds: 300 }),
  "reservation-lookup": Object.freeze({ limit: 60, windowSeconds: 300 }),
  "reservation-cancel": Object.freeze({ limit: 10, windowSeconds: 300 })
});

const defaultDependencies = {
  RateLimitRepository,
  ConfigurationService
};

function serviceError(message, statusCode, code) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function isProduction() {
  return process.env.NODE_ENV === "production" || process.env.SKUCHA_ENV === "production";
}

function normalizeAddress(value) {
  let candidate = String(value || "").trim().replace(/^"|"$/g, "");
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(candidate);
  if (bracketed) {
    candidate = bracketed[1];
  } else if (candidate.split(":").length === 2 && /:\d+$/.test(candidate)) {
    candidate = candidate.replace(/:\d+$/, "");
  }
  return net.isIP(candidate) ? candidate.toLowerCase() : "";
}

function getClientAddress(request) {
  const forwarded = String(getHeader(request && request.headers, "x-forwarded-for") || "")
    .split(",")
    .map(normalizeAddress)
    .filter(Boolean);
  if (forwarded.length) {
    return forwarded[forwarded.length - 1];
  }

  return normalizeAddress(getHeader(request && request.headers, "x-azure-clientip"))
    || normalizeAddress(getHeader(request && request.headers, "x-real-ip"))
    || "unknown";
}

function createBotProtectionService(customDependencies) {
  const dependencies = {
    ...defaultDependencies,
    ...(customDependencies || {})
  };

  async function checkRequest(request, policyKey) {
    const policy = POLICIES[policyKey];
    if (!policy) {
      throw serviceError("Request policy is invalid", 503, "RateLimitPolicyInvalid");
    }

    const secret = typeof dependencies.ConfigurationService.getRateLimitHashSecret === "function"
      ? dependencies.ConfigurationService.getRateLimitHashSecret()
      : "";
    if (!secret) {
      if (isProduction()) {
        throw serviceError("Request protection is unavailable", 503, "RateLimitNotConfigured");
      }
      return { allowed: true, skipped: true };
    }

    const subjectHash = crypto
      .createHmac("sha256", secret)
      .update(getClientAddress(request), "utf8")
      .digest("hex");
    return dependencies.RateLimitRepository.consume(
      policyKey,
      subjectHash,
      policy.limit,
      policy.windowSeconds
    );
  }

  return { checkRequest };
}

let activeService = createBotProtectionService();

module.exports = {
  POLICIES,
  checkRequest: function checkRequestProxy(request, policyKey) {
    return activeService.checkRequest(request, policyKey);
  },
  createBotProtectionService,
  getClientAddress,
  __setDependencies: function __setDependencies(overrides) {
    activeService = createBotProtectionService(overrides);
  },
  __resetDependencies: function __resetDependencies() {
    activeService = createBotProtectionService();
  }
};