function normalizePadsCount(value) {
  if (value === undefined || value === null || (typeof value === "string" && value.trim() === "")) {
    return 1;
  }

  const normalized = typeof value === "string" ? value.trim() : value;
  if (typeof normalized === "string" && !/^\d+$/.test(normalized)) {
    return Number.NaN;
  }

  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) ? parsed : Number.NaN;
}

class Reservation {
  constructor(input) {
    const source = input || {};
    this.firstName = String(source.firstName || "").trim();
    this.lastName = String(source.lastName || "").trim();
    this.fullName = (this.firstName + " " + this.lastName).trim();
    this.email = String(source.email || "").trim().toLowerCase();
    this.phone = String(source.phone || "").replace(/\s+/g, "").trim();
    this.dateFrom = String(source.dateFrom || "").trim();
    this.dateTo = String(source.dateTo || "").trim();
    this.padsCount = normalizePadsCount(source.padsCount);
    this.deliveryMethod = String(source.deliveryMethod || "pickup").trim().toLowerCase();
    this.pickupPoint = String(source.pickupPoint || "").trim();
    this.notes = String(source.notes || "").trim();
    this.acceptTerms = source.acceptTerms === true;
    this.acceptPrivacy = source.acceptPrivacy === true;
    this.earlyStartRequested = source.earlyStartRequested === true;
    this.marketingEmail = source.marketingEmail === true;
    this.createdAt = new Date().toISOString();
  }
}

module.exports = Reservation;
