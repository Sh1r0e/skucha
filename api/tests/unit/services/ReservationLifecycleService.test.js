const Lifecycle = require("../../../services/ReservationLifecycleService");

describe("ReservationLifecycleService", function () {
  it("should_allow_only_the_defined_actor_transitions()", function () {
    expect(Lifecycle.canTransition("Pending", "Confirmed", Lifecycle.ACTOR.SYSTEM)).toBe(true);
    expect(Lifecycle.canTransition("Confirmed", "InProgress", Lifecycle.ACTOR.ADMIN)).toBe(true);
    expect(Lifecycle.canTransition("Confirmed", "InProgress", Lifecycle.ACTOR.CUSTOMER)).toBe(false);
    expect(Lifecycle.canTransition("Cancelled", "Confirmed", Lifecycle.ACTOR.SYSTEM)).toBe(false);
  });

  it("should_keep_cancelled_expired_and_completed_out_of_inventory()", function () {
    expect(Lifecycle.isBlockingStatus("Pending")).toBe(true);
    expect(Lifecycle.isBlockingStatus("CancellationPending")).toBe(true);
    expect(Lifecycle.isBlockingStatus("InProgress")).toBe(true);
    expect(Lifecycle.isBlockingStatus("Cancelled")).toBe(false);
    expect(Lifecycle.isBlockingStatus("Expired")).toBe(false);
    expect(Lifecycle.isBlockingStatus("Completed")).toBe(false);
  });

  it("should_reject_invalid_transitions_with_a_conflict()", function () {
    expect(function () {
      Lifecycle.assertTransition("Completed", "Confirmed", Lifecycle.ACTOR.SYSTEM);
    }).toThrowError(expect.objectContaining({
      statusCode: 409,
      code: "InvalidStatusTransition"
    }));
    expect(Lifecycle.canTransition("Unknown", "Confirmed", Lifecycle.ACTOR.SYSTEM)).toBe(false);
    expect(Lifecycle.canTransition("Pending", "Pending", Lifecycle.ACTOR.SYSTEM)).toBe(false);
  });
});
