const crypto = require("crypto");
const { Buffer } = require("buffer");
const { jsonResponse } = require("./http");

function getHeader(headers, name) {
  if (!headers || !name) {
    return "";
  }

  if (typeof headers.get === "function") {
    return headers.get(name) || headers.get(name.toLowerCase()) || "";
  }

  const direct = headers[name];
  if (direct) {
    return direct;
  }

  const target = String(name).toLowerCase();
  const key = Object.keys(headers).find(function (candidate) {
    return String(candidate).toLowerCase() === target;
  });

  return key ? headers[key] || "" : "";
}

function getRequest(context, req) {
  return req || (context && context.req) || {};
}

function decodeClientPrincipal(request) {
  const encoded = getHeader(request.headers, "x-ms-client-principal");

  if (!encoded) {
    return null;
  }

  try {
    const decoded = Buffer.from(encoded, "base64").toString("utf8");
    const principal = JSON.parse(decoded);
    return principal && typeof principal === "object" ? principal : null;
  } catch (_error) {
    return null;
  }
}

function hasRole(request, role) {
  const principal = decodeClientPrincipal(request);
  return Boolean(
    principal
    && Array.isArray(principal.userRoles)
    && principal.userRoles.includes(role)
  );
}

function reject(context, status, code, message) {
  context.res = jsonResponse(status, { message: message, code: code });
  return true;
}

function requireAdmin(context, req) {
  const request = getRequest(context, req);
  const principal = decodeClientPrincipal(request);

  if (!principal) {
    return reject(context, 401, "AuthenticationRequired", "Authentication is required");
  }

  if (!Array.isArray(principal.userRoles) || !principal.userRoles.includes("admin")) {
    return reject(context, 403, "AdminRoleRequired", "Admin role is required");
  }

  return false;
}

function secretsEqual(expected, provided) {
  const expectedBuffer = Buffer.from(String(expected || ""), "utf8");
  const providedBuffer = Buffer.from(String(provided || ""), "utf8");

  return expectedBuffer.length > 0
    && expectedBuffer.length === providedBuffer.length
    && crypto.timingSafeEqual(expectedBuffer, providedBuffer);
}

function requireInternalSecret(context, req, expectedSecret) {
  const request = getRequest(context, req);
  const provided = getHeader(request.headers, "x-housekeeping-secret");

  if (!secretsEqual(expectedSecret, provided)) {
    return reject(context, 401, "InvalidInternalSecret", "A valid internal secret is required");
  }

  return false;
}

module.exports = {
  decodeClientPrincipal,
  getHeader,
  getRequest,
  hasRole,
  requireAdmin,
  requireInternalSecret,
  secretsEqual
};
