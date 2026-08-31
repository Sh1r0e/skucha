const StripeEventRepository = require("../../../repositories/StripeEventRepository");
const { createEventRepository } = StripeEventRepository;
const { createAsyncIterable } = require("../../helpers/functionTestUtils");

function createRepositoryWithClient(client, now) {
  return createEventRepository({
    TableClient: { fromConnectionString: vi.fn().mockReturnValue(client) },
    ConfigurationService: { getStorageConnectionString: vi.fn().mockReturnValue("UseDevelopmentStorage=true") },
    odata: function odata(strings) {
      const values = Array.prototype.slice.call(arguments, 1);
      return strings.reduce(function (acc, part, index) {
        return acc + part + (values[index] == null ? "" : values[index]);
      }, "");
    },
    now: vi.fn().mockReturnValue(now)
  });
}

describe("StripeEventRepository", function () {
  it("should_claim_a_new_event_once()", async function () {
    const client = {
      createTable: vi.fn().mockResolvedValue(undefined),
      createEntity: vi.fn().mockResolvedValue(undefined)
    };
    const repository = createRepositoryWithClient(client, new Date("2026-08-09T10:00:00.000Z"));

    const result = await repository.claimEvent({ id: "evt-1", type: "checkout.session.completed" });

    expect(result).toEqual({ claimed: true, duplicate: false });
    expect(client.createEntity).toHaveBeenCalledWith(expect.objectContaining({ rowKey: "evt-1", Status: "Processing" }));
  });

  it("should_ignore_a_recently_processed_or_processing_event()", async function () {
    const client = {
      createTable: vi.fn().mockResolvedValue(undefined),
      createEntity: vi.fn().mockRejectedValue(Object.assign(new Error("exists"), { statusCode: 409 })),
      listEntities: vi.fn().mockReturnValue(createAsyncIterable([
        {
          partitionKey: "stripe",
          rowKey: "evt-2",
          Status: "Processed",
          UpdatedAt: "2026-08-09T09:59:00.000Z",
          etag: "etag-1"
        }
      ]))
    };
    const repository = createRepositoryWithClient(client, new Date("2026-08-09T10:00:00.000Z"));

    const result = await repository.claimEvent({ id: "evt-2", type: "checkout.session.completed" });

    expect(result).toMatchObject({ claimed: false, duplicate: true, status: "Processed" });
  });

  it("should_mark_an_event_as_processed()", async function () {
    const client = {
      createTable: vi.fn().mockResolvedValue(undefined),
      listEntities: vi.fn().mockReturnValue(createAsyncIterable([
        { partitionKey: "stripe", rowKey: "evt-3", Status: "Processing", etag: "etag-3" }
      ])),
      updateEntity: vi.fn().mockResolvedValue(undefined)
    };
    const repository = createRepositoryWithClient(client, new Date("2026-08-09T10:00:00.000Z"));

    await repository.markEvent("evt-3", "Processed");

    expect(client.updateEntity).toHaveBeenCalledWith(
      expect.objectContaining({ rowKey: "evt-3", Status: "Processed" }),
      "Merge",
      { etag: "etag-3" }
    );
  });

  it("should_claim_events_without_ids_without_storage()", async function () {
    const repository = createEventRepository({});

    await expect(repository.claimEvent({ type: "customer.created" })).resolves.toEqual({
      claimed: true,
      duplicate: false
    });
  });

  it("should_reclaim_a_stale_processing_event()", async function () {
    const client = {
      createTable: vi.fn().mockResolvedValue(undefined),
      createEntity: vi.fn().mockRejectedValue(Object.assign(new Error("exists"), { statusCode: 409 })),
      listEntities: vi.fn().mockReturnValue(createAsyncIterable([
        {
          partitionKey: "stripe",
          rowKey: "evt-stale",
          Status: "Processing",
          UpdatedAt: "2026-08-09T08:00:00.000Z",
          etag: "etag-stale"
        }
      ])),
      updateEntity: vi.fn().mockResolvedValue({ etag: "etag-reclaimed" })
    };
    const repository = createRepositoryWithClient(client, new Date("2026-08-09T10:00:00.000Z"));

    const result = await repository.claimEvent({ id: "evt-stale", type: "checkout.session.expired" });

    expect(result).toMatchObject({ claimed: true, duplicate: false, status: "Processing" });
    expect(client.updateEntity).toHaveBeenCalled();
  });

  it("should_treat_a_recent_processing_event_as_duplicate()", async function () {
    const client = {
      createTable: vi.fn().mockResolvedValue(undefined),
      createEntity: vi.fn().mockRejectedValue(Object.assign(new Error("exists"), { statusCode: 409 })),
      listEntities: vi.fn().mockReturnValue(createAsyncIterable([
        { partitionKey: "stripe", rowKey: "evt-recent", Status: "Processing", UpdatedAt: "2026-08-09T09:59:00.000Z" }
      ]))
    };
    const repository = createRepositoryWithClient(client, new Date("2026-08-09T10:00:00.000Z"));

    await expect(repository.claimEvent({ id: "evt-recent", type: "checkout.session.completed" })).resolves.toMatchObject({
      claimed: false,
      duplicate: true
    });
  });

  it("should_report_claim_and_mark_errors()", async function () {
    const claimClient = {
      createTable: vi.fn().mockResolvedValue(undefined),
      createEntity: vi.fn().mockRejectedValue(Object.assign(new Error("write"), { statusCode: 500 }))
    };
    const claimRepository = createRepositoryWithClient(claimClient, new Date("2026-08-09T10:00:00.000Z"));
    await expect(claimRepository.claimEvent({ id: "evt-error" })).rejects.toMatchObject({ code: "StorageWriteFailed" });

    const markClient = {
      createTable: vi.fn().mockResolvedValue(undefined),
      listEntities: vi.fn().mockReturnValue(createAsyncIterable([
        { partitionKey: "stripe", rowKey: "evt-mark", Status: "Processing", etag: "etag-mark" }
      ])),
      updateEntity: vi.fn().mockRejectedValue(Object.assign(new Error("conflict"), { statusCode: 412 }))
    };
    const markRepository = createRepositoryWithClient(markClient, new Date("2026-08-09T10:00:00.000Z"));
    await expect(markRepository.markEvent("evt-mark", "Processed", { error: "details" })).rejects.toMatchObject({
      code: "StorageConflict"
    });
    await expect(markRepository.markEvent("", "Processed")).resolves.toBeUndefined();
  });

  it("should_expose_the_default_event_repository_proxies()", async function () {
    const client = {
      createTable: vi.fn().mockResolvedValue(undefined),
      createEntity: vi.fn().mockResolvedValue(undefined),
      listEntities: vi.fn().mockReturnValue(createAsyncIterable([]))
    };
    StripeEventRepository.__setDependencies({
      TableClient: { fromConnectionString: vi.fn().mockReturnValue(client) },
      ConfigurationService: { getStorageConnectionString: vi.fn().mockReturnValue("UseDevelopmentStorage=true") },
      odata: function odata(strings) { return strings.join(""); },
      now: vi.fn().mockReturnValue(new Date("2026-08-09T10:00:00.000Z"))
    });

    await StripeEventRepository.claimEvent({ id: "evt-proxy", type: "test" });
    await StripeEventRepository.markEvent("evt-proxy", "Processed");
    StripeEventRepository.__resetDependencies();

    expect(client.createEntity).toHaveBeenCalled();
  });
});
