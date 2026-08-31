const InventoryLeaseRepository = require("../../../repositories/InventoryLeaseRepository");
const { createRepository } = InventoryLeaseRepository;

function createAsyncClient(existing) {
  return {
    createTable: vi.fn().mockResolvedValue(undefined),
    getEntity: vi.fn().mockImplementation(async function () {
      if (!existing) {
        throw Object.assign(new Error("missing"), { statusCode: 404 });
      }
      return existing;
    }),
    createEntity: vi.fn().mockResolvedValue(undefined),
    updateEntity: vi.fn().mockResolvedValue({ etag: "etag-new" })
  };
}

describe("InventoryLeaseRepository", function () {
  it("should_create_a_global_lease_when_no_active_lease_exists()", async function () {
    const client = createAsyncClient(null);
    client.createEntity.mockResolvedValue({ etag: "etag-created" });
    const repository = createRepository({
      TableClient: { fromConnectionString: vi.fn().mockReturnValue(client) },
      ConfigurationService: { getStorageConnectionString: vi.fn().mockReturnValue("UseDevelopmentStorage=true") },
      uuidv4: vi.fn().mockReturnValue("lease-1"),
      now: vi.fn().mockReturnValue(new Date("2026-08-09T10:00:00.000Z"))
    });

    const lease = await repository.acquireLease("reservation-1", 30000);

    expect(client.createEntity).toHaveBeenCalledWith(expect.objectContaining({
      partitionKey: "global",
      rowKey: "reservation-inventory",
      LeaseId: "lease-1"
    }));
    expect(lease.leaseId).toBe("lease-1");
    expect(lease.etag).toBe("etag-created");
  });

  it("should_reject_an_active_lease()", async function () {
    const client = createAsyncClient({
      partitionKey: "global",
      rowKey: "reservation-inventory",
      LeaseId: "lease-old",
      ExpiresAt: "2026-08-09T10:01:00.000Z",
      etag: "etag-old"
    });
    const repository = createRepository({
      TableClient: { fromConnectionString: vi.fn().mockReturnValue(client) },
      ConfigurationService: { getStorageConnectionString: vi.fn().mockReturnValue("UseDevelopmentStorage=true") },
      uuidv4: vi.fn().mockReturnValue("lease-new"),
      now: vi.fn().mockReturnValue(new Date("2026-08-09T10:00:00.000Z"))
    });

    await expect(repository.acquireLease("reservation-2", 30000)).rejects.toMatchObject({
      statusCode: 409,
      code: "InventoryBusy"
    });
  });

  it("should_reclaim_an_expired_lease_with_its_etag()", async function () {
    const client = createAsyncClient({
      partitionKey: "global",
      rowKey: "reservation-inventory",
      LeaseId: "lease-old",
      ExpiresAt: "2026-08-09T09:59:00.000Z",
      etag: "etag-old"
    });
    const repository = createRepository({
      TableClient: { fromConnectionString: vi.fn().mockReturnValue(client) },
      ConfigurationService: { getStorageConnectionString: vi.fn().mockReturnValue("UseDevelopmentStorage=true") },
      uuidv4: vi.fn().mockReturnValue("lease-new"),
      now: vi.fn().mockReturnValue(new Date("2026-08-09T10:00:00.000Z"))
    });

    const lease = await repository.acquireLease("reservation-2", 30000);

    expect(client.updateEntity).toHaveBeenCalledWith(
      expect.objectContaining({ LeaseId: "lease-new" }),
      "Merge",
      { etag: "etag-old" }
    );
    expect(lease.etag).toBe("etag-new");
  });

  it("should_release_a_lease_and_ignore_an_etag_conflict()", async function () {
    const client = createAsyncClient(null);
    client.updateEntity.mockRejectedValue(Object.assign(new Error("changed"), { statusCode: 412 }));
    const repository = createRepository({
      TableClient: { fromConnectionString: vi.fn().mockReturnValue(client) },
      ConfigurationService: { getStorageConnectionString: vi.fn().mockReturnValue("UseDevelopmentStorage=true") },
      uuidv4: vi.fn().mockReturnValue("lease-release"),
      now: vi.fn().mockReturnValue(new Date("2026-08-09T10:00:00.000Z"))
    });

    await expect(repository.releaseLease({ leaseId: "lease-1", etag: "etag-old" })).resolves.toBeUndefined();
    await expect(repository.releaseLease(null)).resolves.toBeUndefined();
  });

  it("should_reject_storage_initialization_failures()", async function () {
    const client = createAsyncClient(null);
    client.createTable.mockRejectedValue(Object.assign(new Error("init"), { statusCode: 500 }));
    const repository = createRepository({
      TableClient: { fromConnectionString: vi.fn().mockReturnValue(client) },
      ConfigurationService: { getStorageConnectionString: vi.fn().mockReturnValue("UseDevelopmentStorage=true") },
      uuidv4: vi.fn().mockReturnValue("lease-init"),
      now: vi.fn().mockReturnValue(new Date("2026-08-09T10:00:00.000Z"))
    });

    await expect(repository.acquireLease("reservation-1", 30000)).rejects.toMatchObject({ statusCode: 500 });
  });

  it("should_map_create_races_to_inventory_busy()", async function () {
    const client = createAsyncClient(null);
    client.createEntity.mockRejectedValue(Object.assign(new Error("race"), { statusCode: 409 }));
    const repository = createRepository({
      TableClient: { fromConnectionString: vi.fn().mockReturnValue(client) },
      ConfigurationService: { getStorageConnectionString: vi.fn().mockReturnValue("UseDevelopmentStorage=true") },
      uuidv4: vi.fn().mockReturnValue("lease-race"),
      now: vi.fn().mockReturnValue(new Date("2026-08-09T10:00:00.000Z"))
    });

    await expect(repository.acquireLease("reservation-1", 30000)).rejects.toMatchObject({
      statusCode: 409,
      code: "InventoryBusy"
    });
  });

  it("should_require_storage_configuration()", async function () {
    const repository = createRepository({
      ConfigurationService: { getStorageConnectionString: vi.fn().mockReturnValue("") }
    });

    await expect(repository.acquireLease("reservation-1", 30000)).rejects.toMatchObject({
      statusCode: 503,
      code: "StorageNotConfigured"
    });
  });

  it("should_expose_the_default_lease_repository_proxies()", async function () {
    const client = createAsyncClient(null);
    InventoryLeaseRepository.__setDependencies({
      TableClient: { fromConnectionString: vi.fn().mockReturnValue(client) },
      ConfigurationService: { getStorageConnectionString: vi.fn().mockReturnValue("UseDevelopmentStorage=true") },
      uuidv4: vi.fn().mockReturnValue("proxy-lease"),
      now: vi.fn().mockReturnValue(new Date("2026-08-09T10:00:00.000Z"))
    });

    const lease = await InventoryLeaseRepository.acquireLease("proxy-owner", 30000);
    await InventoryLeaseRepository.releaseLease(lease);
    InventoryLeaseRepository.__resetDependencies();

    expect(lease.leaseId).toBe("proxy-lease");
  });

  it("should_propagate_non_not_found_lease_read_errors()", async function () {
    const client = createAsyncClient(null);
    client.getEntity.mockRejectedValue(Object.assign(new Error("read"), { statusCode: 500 }));
    const repository = createRepository({
      TableClient: { fromConnectionString: vi.fn().mockReturnValue(client) },
      ConfigurationService: { getStorageConnectionString: vi.fn().mockReturnValue("storage") },
      uuidv4: vi.fn().mockReturnValue("lease-read"),
      now: vi.fn().mockReturnValue(new Date("2026-08-09T10:00:00.000Z"))
    });

    await expect(repository.acquireLease("owner", 30000)).rejects.toMatchObject({ statusCode: 500 });
  });

  it("should_use_owner_and_default_etag_fallbacks()", async function () {
    const client = createAsyncClient({
      partitionKey: "global",
      rowKey: "reservation-inventory",
      ExpiresAt: "2026-08-09T09:59:00.000Z"
    });
    client.updateEntity.mockResolvedValue({});
    const repository = createRepository({
      TableClient: { fromConnectionString: vi.fn().mockReturnValue(client) },
      ConfigurationService: { getStorageConnectionString: vi.fn().mockReturnValue("storage") },
      uuidv4: vi.fn().mockReturnValue("lease-fallback"),
      now: vi.fn().mockReturnValue(new Date("2026-08-09T10:00:00.000Z"))
    });

    const lease = await repository.acquireLease("", 0);
    expect(lease.leaseId).toBe("lease-fallback");
    expect(client.updateEntity.mock.calls[0][0].Owner).toBe("unknown");
  });

  it("should_propagate_non_conflict_lease_write_errors()", async function () {
    const client = createAsyncClient(null);
    client.createEntity.mockRejectedValue(new Error("write"));
    const repository = createRepository({
      TableClient: { fromConnectionString: vi.fn().mockReturnValue(client) },
      ConfigurationService: { getStorageConnectionString: vi.fn().mockReturnValue("storage") },
      uuidv4: vi.fn().mockReturnValue("lease-write"),
      now: vi.fn().mockReturnValue(new Date("2026-08-09T10:00:00.000Z"))
    });

    await expect(repository.acquireLease("owner", 30000)).rejects.toThrow("write");
  });

  it("should_propagate_non_conflict_release_errors()", async function () {
    const client = createAsyncClient(null);
    client.updateEntity.mockRejectedValue(new Error("release"));
    const repository = createRepository({
      TableClient: { fromConnectionString: vi.fn().mockReturnValue(client) },
      ConfigurationService: { getStorageConnectionString: vi.fn().mockReturnValue("storage") },
      now: vi.fn().mockReturnValue(new Date("2026-08-09T10:00:00.000Z"))
    });

    await expect(repository.releaseLease({ leaseId: "lease-release" })).rejects.toThrow("release");
  });
});
