const TimeService = require("../../../services/ReservationTimeService");

describe("ReservationTimeService", function () {
  const timeZone = "Europe/Warsaw";

  it("should_parse_warsaw_midnight_as_a_utc_instant()", function () {
    const result = TimeService.parseDateOnlyAtStart("2026-08-10", timeZone);

    expect(result.toISOString()).toBe("2026-08-09T22:00:00.000Z");
  });

  it("should_apply_the_cutoff_at_the_exact_boundary()", function () {
    const deadline = TimeService.getCancellationDeadline("2026-08-10", 24, timeZone);

    expect(TimeService.isCancellationAllowed("2026-08-10", 24, deadline, timeZone)).toBe(true);
    expect(TimeService.isCancellationAllowed(
      "2026-08-10",
      24,
      new Date(deadline.getTime() + 1),
      timeZone
    )).toBe(false);
  });

  it("should_use_the_correct_offset_across_warsaw_dst()", function () {
    const summer = TimeService.parseDateOnlyAtStart("2026-07-10", timeZone);
    const winter = TimeService.parseDateOnlyAtStart("2026-01-10", timeZone);

    expect(summer.toISOString()).toBe("2026-07-09T22:00:00.000Z");
    expect(winter.toISOString()).toBe("2026-01-09T23:00:00.000Z");
  });

  it("should_calculate_pending_expiration_from_creation_time()", function () {
    const result = TimeService.getPendingExpiration("2026-08-09T10:00:00.000Z", 2);

    expect(result.toISOString()).toBe("2026-08-09T12:00:00.000Z");
  });

  it("should_reject_invalid_calendar_and_clock_values()", function () {
    expect(function () { TimeService.parseDateOnlyAsUtc("2026-02-30"); }).toThrowError(
      expect.objectContaining({ code: "InvalidDate" })
    );
    expect(function () { TimeService.parseDateOnlyAtStart("not-a-date", timeZone); }).toThrowError(
      expect.objectContaining({ code: "InvalidDate" })
    );
    expect(function () { TimeService.isCancellationAllowed("2026-08-10", 24, "invalid", timeZone); }).toThrowError(
      expect.objectContaining({ code: "InvalidDate" })
    );
    expect(function () { TimeService.getPendingExpiration("invalid", 2); }).toThrowError(
      expect.objectContaining({ code: "InvalidDate" })
    );
  });
});
