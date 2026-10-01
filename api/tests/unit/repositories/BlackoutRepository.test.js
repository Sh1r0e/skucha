const BlackoutRepository = require("../../../repositories/BlackoutRepository");
const { createAsyncIterable } = require("../../helpers/functionTestUtils");

function createRepository(client, overrides) {
  return BlackoutRepository.createBlackoutRepository({
    TableClient: { fromConnectionString: vi.fn().mockReturnValue(client) },
    ConfigurationService: { getStorageConnectionString: vi.fn().mockReturnValue("storage") },
    uuidv4: vi.fn().mockReturnValue("blackout-1"),
    ...(overrides || {})
  });
}

describe("BlackoutRepository", function () {
  beforeEach(function () {
    BlackoutRepository.__resetDependencies();
  });

  it("should_save_and_list_blackout_periods", async function () {
    const client = {
      createTable: vi.fn().mockResolvedValue(undefined),
      createEntity: vi.fn().mockResolvedValue(undefined),
      listEntities: vi.fn().mockReturnValue(createAsyncIterable([
        {
          rowKey: "blackout-2",
          FromDate: "2026-08-20",
          ToDate: "2026-08-22",
          Reason: "Later"
        },
        {
          rowKey: "blackout-1",
          FromDate: "2026-08-10",
          ToDate: "2026-08-12",
          CreatedAt: "2026-08-01T10:00:00.000Z"
        }
      ]))
    };
    const repository = createRepository(client, { uuidv4: vi.fn().mockReturnValue("blackout-new") });

    const saved = await repository.saveBlackout({
      fromDate: "2026-08-15",
      toDate: "2026-08-16",
      reason: "Weekend",
      createdBy: "admin@example.com"
    });
    const listed = await repository.getBlackouts();

    expect(client.createEntity).toHaveBeenCalledWith(expect.objectContaining({
      partitionKey: "blackout",
      rowKey: "blackout-new",
      FromDate: "2026-08-15",
      ToDate: "2026-08-16",
      Reason: "Weekend",
      CreatedBy: "admin@example.com"
    }));
    expect(saved).toEqual(expect.objectContaining({
      id: "blackout-new",
      fromDate: "2026-08-15",
      toDate: "2026-08-16"
    }));
    expect(listed.map(function (blackout) { return blackout.id; })).toEqual([
      "blackout-1",
      "blackout-2"
    ]);
  });

  it("should_delete_a_period_with_its_etag", async function () {
    const client = {
      createTable: vi.fn().mockResolvedValue(undefined),
      getEntity: vi.fn().mockResolvedValue({ etag: "etag-1" }),
      deleteEntity: vi.fn().mockResolvedValue(undefined)
    };
    const repository = createRepository(client);

    await expect(repository.deleteBlackout("blackout-1")).resolves.toBe(true);

    expect(client.deleteEntity).toHaveBeenCalledWith("blackout", "blackout-1", { etag: "etag-1" });
  });

  it("should_return_false_when_delete_target_is_missing", async function () {
    const client = {
      createTable: vi.fn().mockResolvedValue(undefined),
      getEntity: vi.fn().mockRejectedValue(Object.assign(new Error("missing"), { statusCode: 404 }))
    };
    const repository = createRepository(client);

    await expect(repository.deleteBlackout("missing")).resolves.toBe(false);
  });

  it("should_require_storage_configuration", async function () {
    const repository = BlackoutRepository.createBlackoutRepository({
      ConfigurationService: { getStorageConnectionString: vi.fn().mockReturnValue("") }
    });

    await expect(repository.getBlackouts()).rejects.toMatchObject({
      statusCode: 503,
      code: "StorageNotConfigured"
    });
  });

  it("should_ignore_existing_tables_and_wrap_storage_failures", async function () {
    const client = {
      createTable: vi.fn().mockRejectedValueOnce(Object.assign(new Error("exists"), { statusCode: 409 })),
      createEntity: vi.fn().mockRejectedValue(Object.assign(new Error("write"), { statusCode: 502 })),
      listEntities: vi.fn().mockImplementation(function () {
        throw Object.assign(new Error("read"), { statusCode: 500 });
      })
    };
    const repository = createRepository(client);

    await expect(repository.saveBlackout({ fromDate: "2026-08-15", toDate: "2026-08-16" }))
      .rejects.toMatchObject({ statusCode: 502 });

    const readRepository = createRepository({
      createTable: vi.fn().mockRejectedValue(Object.assign(new Error("init"), { statusCode: 500 })),
      listEntities: vi.fn()
    });
    await expect(readRepository.getBlackouts()).rejects.toMatchObject({
      statusCode: 500,
      code: "StorageInitializationFailed"
    });

    await expect(repository.getBlackouts()).rejects.toMatchObject({ statusCode: 500 });
  });

  it("should_wrap_delete_read_and_write_failures", async function () {
    const readClient = {
      createTable: vi.fn().mockResolvedValue(undefined),
      getEntity: vi.fn().mockRejectedValue(Object.assign(new Error("read"), { statusCode: 502 }))
    };
    await expect(createRepository(readClient).deleteBlackout("blackout-1"))
      .rejects.toMatchObject({ statusCode: 502, code: "StorageReadFailed" });

    const writeClient = {
      createTable: vi.fn().mockResolvedValue(undefined),
      getEntity: vi.fn().mockResolvedValue({}),
      deleteEntity: vi.fn().mockRejectedValue(new Error("delete"))
    };
    await expect(createRepository(writeClient).deleteBlackout("blackout-1"))
      .rejects.toMatchObject({ statusCode: 503, code: "StorageDeleteFailed" });
  });

  it("should_expose_repository_proxies", async function () {
    const client = {
      createTable: vi.fn().mockResolvedValue(undefined),
      listEntities: vi.fn().mockReturnValue(createAsyncIterable([]))
    };
    BlackoutRepository.__setDependencies({
      TableClient: { fromConnectionString: vi.fn().mockReturnValue(client) },
      ConfigurationService: { getStorageConnectionString: vi.fn().mockReturnValue("storage") }
    });

    await expect(BlackoutRepository.getBlackouts()).resolves.toEqual([]);
    BlackoutRepository.__resetDependencies();
  });
});