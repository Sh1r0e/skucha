const Reservation = require("../../../models/Reservation");

describe("Reservation model", function () {
  it("should_normalize_payload_fields()", function () {
    const reservation = new Reservation({
      firstName: "  JAN  ",
      lastName: "  KOWALSKI  ",
      email: "  JAN@EXAMPLE.COM  ",
      phone: " +48 500 500 500 ",
      deliveryMethod: " PICKUP ",
      padsCount: "3"
    });

    expect(reservation.firstName).toBe("JAN");
    expect(reservation.lastName).toBe("KOWALSKI");
    expect(reservation.email).toBe("jan@example.com");
    expect(reservation.phone).toBe("+48500500500");
    expect(reservation.deliveryMethod).toBe("pickup");
    expect(reservation.padsCount).toBe(3);
  });
});
