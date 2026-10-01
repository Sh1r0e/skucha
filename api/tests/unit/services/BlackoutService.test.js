const BlackoutService = require("../../../services/BlackoutService");

describe("BlackoutService", function () {
  beforeEach(function () {
    BlackoutService.__resetDependencies();
  });

  it("should_create_a_blackout_period_without_storage_lease_in_local_mode", async function () {
    const saveBlackout = vi.fn().mockResolvedValue({
      id: "blackout-1",
      fromDate: "2026-08-15",
      toDate: "2026-08-16",
      reason: "Closed for the weekend"
    });

    BlackoutService.__setDependencies({
      BlackoutRepository: { saveBlackout },
      ConfigurationService: { getStorageConnectionString: vi.fn().mockReturnValue("") }
    });

    await expect(BlackoutService.createBlackout({
      fromDate: "2026-08-15",
      toDate: "2026-08-16",
      reason: "Closed for the weekend"
    })).resolves.toEqual(expect.objectContaining({ id: "blackout-1" }));
    expect(saveBlackout).toHaveBeenCalledWith({
      fromDate: "2026-08-15",
      toDate: "2026-08-16",
      reason: "Closed for the weekend",
      createdBy: undefined
    });
  });

  it("should_use_the_inventory_lease_for_storage_changes", async function () {
    const acquireLease = vi.fn().mockResolvedValue({ leaseId: "lease-1" });
    const releaseLease = vi.fn().mockResolvedValue(undefined);
    const saveBlackout = vi.fn().mockResolvedValue({ id: "blackout-1" });

    BlackoutService.__setDependencies({
      BlackoutRepository: { saveBlackout },
      ConfigurationService: { getStorageConnectionString: vi.fn().mockReturnValue("storage") },
      InventoryLeaseRepository: { acquireLease, releaseLease }
    });

    await BlackoutService.createBlackout({ fromDate: "2026-08-15", toDate: "2026-08-16" });

    expect(acquireLease).toHaveBeenCalledWith("blackout-update", 30000);
    expect(releaseLease).toHaveBeenCalledWith({ leaseId: "lease-1" });
  });

  it("should_reject_invalid_date_ranges_and_long_reasons", async function () {
    BlackoutService.__setDependencies({
      BlackoutRepository: { saveBlackout: vi.fn() },
      ConfigurationService: { getStorageConnectionString: vi.fn().mockReturnValue("") }
    });

    await expect(BlackoutService.createBlackout({
      fromDate: "2026-02-30",
      toDate: "2026-03-01"
    })).rejects.toMatchObject({ code: "InvalidDate" });
    await expect(BlackoutService.createBlackout({
      fromDate: "2026-08-16",
      toDate: "2026-08-15"
    })).rejects.toMatchObject({ code: "InvalidDateRange" });
    await expect(BlackoutService.createBlackout({
      fromDate: "2026-08-15",
      toDate: "2026-08-16",
      reason: "x".repeat(201)
    })).rejects.toMatchObject({ code: "ReasonTooLong" });
  });

  it("should_delete_existing_periods_and_reject_missing_periods", async function () {
    const deleteBlackout = vi.fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    BlackoutService.__setDependencies({
      BlackoutRepository: { deleteBlackout },
      ConfigurationService: { getStorageConnectionString: vi.fn().mockReturnValue("") }
    });

    await expect(BlackoutService.deleteBlackout("blackout-1")).resolves.toEqual({ id: "blackout-1" });
    await expect(BlackoutService.deleteBlackout("blackout-2")).rejects.toMatchObject({ code: "NotFound" });
    expect(deleteBlackout).toHaveBeenNthCalledWith(1, "blackout-1");
  });
});