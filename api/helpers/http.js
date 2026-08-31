const { Buffer } = require("buffer");

const DEFAULT_MAX_JSON_BODY_BYTES = 16 * 1024;

const JSON_SECURITY_HEADERS = Object.freeze({
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store, max-age=0",
  "Content-Security-Policy": "default-src 'none'; base-uri 'none'; frame-ancestors 'none';",
  "Pragma": "no-cache",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY"
});

function getHeader(headers, name) {
  if (!headers || !name) {
    return "";
  }

  if (typeof headers.get === "function") {
    return headers.get(name) || headers.get(name.toLowerCase()) || "";
  }

  const target = String(name).toLowerCase();
  const key = Object.keys(headers).find(function (candidate) {
    return String(candidate).toLowerCase() === target;
  });

  return key ? headers[key] || "" : "";
}

function rejectNonJsonRequest(context, request) {
  const contentType = String(getHeader(request && request.headers, "content-type") || "");
  const mediaType = contentType.split(";", 1)[0].trim().toLowerCase();

  if (!mediaType || mediaType === "application/json") {
    return false;
  }

  context.res = jsonResponse(415, {
    message: "Request Content-Type must be application/json",
    code: "UnsupportedMediaType"
  });
  return true;
}

function bodyByteLength(request) {
  if (!request || request.body === undefined || request.body === null) {
    const contentLength = Number(getHeader(request && request.headers, "content-length"));
    return Number.isFinite(contentLength) && contentLength >= 0 ? contentLength : 0;
  }

  if (Buffer.isBuffer(request.body)) {
    return request.body.length;
  }

  if (typeof request.body === "string") {
    return Buffer.byteLength(request.body, "utf8");
  }

  try {
    return Buffer.byteLength(JSON.stringify(request.body), "utf8");
  } catch (_error) {
    return Number.POSITIVE_INFINITY;
  }
}

function rejectOversizedRequest(context, request, maxBytes) {
  const limit = Number(maxBytes) || DEFAULT_MAX_JSON_BODY_BYTES;

  if (bodyByteLength(request) <= limit) {
    return false;
  }

  context.res = jsonResponse(413, {
    message: "Request body is too large",
    code: "PayloadTooLarge"
  });
  return true;
}

function jsonResponse(status, body, headers) {
  return {
    status: status,
    headers: {
      ...JSON_SECURITY_HEADERS,
      ...(headers || {})
    },
    body: body
  };
}

module.exports = {
  JSON_SECURITY_HEADERS,
  bodyByteLength,
  getHeader,
  jsonResponse,
  rejectNonJsonRequest,
  rejectOversizedRequest
};