"use strict";

const { deploymentDirectory } = require("../../scripts/build-api");

describe("API deployment bundle", function () {
  it("should flatten nested Function folders while preserving route names", function () {
    expect(deploymentDirectory("admin/reservations")).toBe("admin-reservations");
    expect(deploymentDirectory("admin/housekeeping")).toBe("admin-housekeeping");
    expect(deploymentDirectory("internal/housekeeping")).toBe("internal-housekeeping");
    expect(deploymentDirectory("ping")).toBe("ping");
  });
});