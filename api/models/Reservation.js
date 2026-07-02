class Reservation {
  constructor(input) {
    this.firstName = String(input.firstName || "").trim();
    this.lastName = String(input.lastName || "").trim();
    this.fullName = String(input.fullName || (this.firstName + " " + this.lastName)).trim();
    this.email = String(input.email || "").trim().toLowerCase();
    this.phone = String(input.phone || "").replace(/\s+/g, "").trim();
    this.dateFrom = String(input.dateFrom || "").trim();
    this.dateTo = String(input.dateTo || "").trim();
    this.padsCount = Number.parseInt(input.padsCount, 10) || 1;
    this.deliveryMethod = String(input.deliveryMethod || "pickup").trim().toLowerCase();
    this.pickupPoint = String(input.pickupPoint || "").trim();
    this.notes = String(input.notes || "").trim();
    this.acceptTerms = Boolean(input.acceptTerms);
    this.createdAt = new Date().toISOString();
  }
}

module.exports = Reservation;
