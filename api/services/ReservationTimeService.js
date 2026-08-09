const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function invalidDate(message) {
  const error = new Error(message);
  error.statusCode = 400;
  error.code = "InvalidDate";
  return error;
}

function dateParts(value) {
  const match = DATE_PATTERN.exec(String(value || ""));

  if (!match) {
    throw invalidDate("Date must be in YYYY-MM-DD format");
  }

  const parts = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3])
  };
  const probe = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));

  if (probe.getUTCFullYear() !== parts.year
    || probe.getUTCMonth() !== parts.month - 1
    || probe.getUTCDate() !== parts.day) {
    throw invalidDate("Date is invalid");
  }

  return parts;
}

function formatterFor(timeZone) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  });
}

function getTimeZoneOffsetMs(date, timeZone) {
  const values = {};
  formatterFor(timeZone).formatToParts(date).forEach(function (part) {
    if (part.type !== "literal") {
      values[part.type] = Number(part.value);
    }
  });

  const wallClockAsUtc = Date.UTC(
    values.year,
    values.month - 1,
    values.day,
    values.hour,
    values.minute,
    values.second
  );

  return wallClockAsUtc - date.getTime();
}

function zonedDateTimeToUtc(parts, timeZone) {
  let timestamp = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour || 0,
    parts.minute || 0,
    parts.second || 0
  );

  for (let attempt = 0; attempt < 3; attempt += 1) {
    timestamp = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour || 0,
      parts.minute || 0,
      parts.second || 0
    ) - getTimeZoneOffsetMs(new Date(timestamp), timeZone);
  }

  return new Date(timestamp);
}

function parseDateOnlyAtStart(value, timeZone) {
  const parts = dateParts(value);
  return zonedDateTimeToUtc({ ...parts, hour: 0, minute: 0, second: 0 }, timeZone);
}

function parseDateOnlyAsUtc(value) {
  const parts = dateParts(value);
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
}

function getCancellationDeadline(value, cutoffHours, timeZone) {
  const rentalStart = parseDateOnlyAtStart(value, timeZone);
  return new Date(rentalStart.getTime() - (Number(cutoffHours) * 60 * 60 * 1000));
}

function isCancellationAllowed(value, cutoffHours, now, timeZone) {
  const currentTime = now instanceof Date ? now : new Date(now);

  if (Number.isNaN(currentTime.getTime())) {
    throw invalidDate("Current time is invalid");
  }

  return currentTime.getTime() <= getCancellationDeadline(value, cutoffHours, timeZone).getTime();
}

function getPendingExpiration(createdAt, expiryHours) {
  const created = new Date(createdAt);

  if (Number.isNaN(created.getTime())) {
    throw invalidDate("CreatedAt is invalid");
  }

  return new Date(created.getTime() + (Number(expiryHours) * 60 * 60 * 1000));
}

module.exports = {
  getCancellationDeadline,
  getPendingExpiration,
  getTimeZoneOffsetMs,
  isCancellationAllowed,
  parseDateOnlyAsUtc,
  parseDateOnlyAtStart,
  zonedDateTimeToUtc
};
