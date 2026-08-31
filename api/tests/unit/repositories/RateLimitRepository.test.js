const RateLimitRepository = require("../../../repositories/RateLimitRepository");

const SUBJECT_HASH = "a".repeat(64);

function createClient() {
  const entities = new Map();
  let etag = 0;

  return {
    entities,
    createTable: vi.fn().mockResolvedValue(undefined),
    getEntity: vi.fn().mockImplementation(async function (partitionKey, rowKey) {
      const entity = entities.get(partitionKey + ":" + rowKey);
      if (!entity) {
        throw Object.assign(new Error("missing"), { statusCode: 404 });
      }
      return { ...entity };
    }),
    createEntity: vi.fn().mockImplementation(async function (entity) {
      const key = entity.partitionKey + ":" + entity.rowKey;
      if (entities.has(key)) {
        throw Object.assign(new Error("exists"), { statusCode: 409 });
      }
      etag += 1;
      entities.set(key, { ...entity, etag: "etag-" + etag });
      return { etag: "etag-" + etag };
    }),
    updateEntity: vi.fn().mockImplementation(async function (entity, _mode, options) {
      const key = entity.partitionKey + ":" + entity.rowKey;
      const existing = entities.get(key);
      if (!existing || (options && options.etag && options.etag !== existing.etag)) {
        throw Object.assign(new Error("changed"), { statusCode: 412 });
      }
      etag += 1;
      entities.set(key, { ...existing, ...entity, etag: "etag-" + etag });
      return { etag: "etag-" + etag };
    })
  };
}

function createRepository(client, now) {
  return RateLimitRepository.createRateLimitRepository({
    TableClient: { fromConnectionString: vi.fn().mockReturnValue(client) },
    ConfigurationService: { getStorageConnectionString: vi.fn().mockReturnValue("storage") },
    now: vi.fn().mockReturnValue(now || new Date("2026-08-31T12:00:00.000Z"))
  });
}

describe("RateLimitRepository", function () {
  it("should_allow_only_the_configured_number_of_requests_in_a_window", async function () {
    const client = createClient();
    const repository = createRepository(client);

    await expect(repository.consume("reservation-create", SUBJECT_HASH, 2, 300))
      .resolves.toMatchObject({ allowed: true, remaining: 1 });
    await expect(repository.consume("reservation-create", SUBJECT_HASH, 2, 300))
      .resolves.toMatchObject({ allowed: true, remaining: 0 });
    await expect(repository.consume("reservation-create", SUBJECT_HASH, 2, 300))
      .resolves.toMatchObject({ allowed: false, remaining: 0 });
  });

  it("should_reset_the_existing_entity_when_the_window_changes", async function () {
    const client = createClient();
    const first = createRepository(client, new Date("2026-08-31T12:00:00.000Z"));
    const second = createRepository(client, new Date("2026-08-31T12:05:00.000Z"));

    await first.consume("reservation-create", SUBJECT_HASH, 1, 300);
    await expect(second.consume("reservation-create", SUBJECT_HASH, 1, 300))
      .resolves.toMatchObject({ allowed: true });
    expect(client.entities.size).toBe(1);
    expect(Array.from(client.entities.values())[0]).toMatchObject({
      Count: 1,
      WindowStartedAt: "2026-08-31T12:05:00.000Z"
    });
  });

  it("should_retry_create_and_etag_races", async function () {
    const client = createClient();
    const originalCreate = client.createEntity.getMockImplementation();
    const originalUpdate = client.updateEntity.getMockImplementation();
    client.createEntity
      .mockImplementationOnce(async function (entity) {
        await originalCreate(entity);
        throw Object.assign(new Error("race"), { statusCode: 409 });
      })
      .mockImplementation(originalCreate);
    client.updateEntity
      .mockRejectedValueOnce(Object.assign(new Error("changed"), { statusCode: 412 }))
      .mockImplementation(originalUpdate);
    const repository = createRepository(client);

    await expect(repository.consume("availability", SUBJECT_HASH, 3, 60))
      .resolves.toMatchObject({ allowed: true, remaining: 1 });
  });

  it("should_fail_closed_when_storage_or_policy_is_invalid", async function () {
    const missingStorage = RateLimitRepository.createRateLimitRepository({
      ConfigurationService: { getStorageConnectionString: vi.fn().mockReturnValue("") }
    });

    await expect(missingStorage.consume("availability", SUBJECT_HASH, 1, 60))
      .rejects.toMatchObject({ statusCode: 503, code: "RateLimitStorageNotConfigured" });
    await expect(createRepository(createClient()).consume("INVALID!", SUBJECT_HASH, 1, 60))
      .rejects.toMatchObject({ statusCode: 503, code: "RateLimitPolicyInvalid" });
  });
});