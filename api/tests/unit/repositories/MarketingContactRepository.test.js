const crypto = require("crypto");
const MarketingContactRepository = require("../../../repositories/MarketingContactRepository");

describe("MarketingContactRepository", function () {
  let mockClient;

  beforeEach(function () {
    mockClient = {
      createTable: vi.fn().mockResolvedValue(undefined),
      upsertEntity: vi.fn().mockResolvedValue(undefined)
    };

    MarketingContactRepository.__resetDependencies();
    MarketingContactRepository.__setDependencies({
      TableClient: {
        fromConnectionString: vi.fn().mockReturnValue(mockClient)
      },
      ConfigurationService: {
        getStorageConnectionString: vi.fn().mockReturnValue("UseDevelopmentStorage=true")
      }
    });
  });

  it("should_upsert_a_normalized_contact_with_a_stable_key_and_consent_audit()", async function () {
    const result = await MarketingContactRepository.upsertContact({
      email: " Jan.Kowalski@Example.com ",
      firstName: "Jan",
      lastName: "Kowalski",
      reservationId: "res-1",
      consentRecordedAt: "2026-08-31T12:00:00.000Z",
      consentIp: "192.0.2.1",
      consentUserAgent: "test-agent"
    });
    const expectedKey = crypto
      .createHash("sha256")
      .update("jan.kowalski@example.com", "utf8")
      .digest("hex");

    expect(mockClient.upsertEntity).toHaveBeenCalledWith({
      partitionKey: expectedKey.slice(0, 2),
      rowKey: expectedKey,
      Email: "jan.kowalski@example.com",
      Status: "Subscribed",
      ConsentRecordedAt: "2026-08-31T12:00:00.000Z",
      ConsentSource: "Reservation",
      ConsentIp: "192.0.2.1",
      ConsentUserAgent: "test-agent",
      FirstName: "Jan",
      LastName: "Kowalski",
      LastReservationId: "res-1"
    }, "Merge");
    expect(result).toEqual({
      email: "jan.kowalski@example.com",
      status: "Subscribed",
      consentRecordedAt: "2026-08-31T12:00:00.000Z"
    });
  });

  it("should_tolerate_an_existing_table_and_default_optional_contact_data()", async function () {
    mockClient.createTable.mockRejectedValue({ statusCode: 409 });

    const result = await MarketingContactRepository.upsertContact({ email: "jan@example.com" });

    expect(mockClient.upsertEntity).toHaveBeenCalledWith(
      expect.objectContaining({
        Email: "jan@example.com",
        ConsentRecordedAt: expect.any(String),
        ConsentIp: "",
        ConsentUserAgent: "",
        FirstName: "",
        LastName: "",
        LastReservationId: ""
      }),
      "Merge"
    );
    expect(result.status).toBe("Subscribed");
  });

  it("should_fail_when_storage_is_not_configured()", async function () {
    MarketingContactRepository.__setDependencies({
      ConfigurationService: {
        getStorageConnectionString: vi.fn().mockReturnValue("")
      }
    });

    await expect(
      MarketingContactRepository.upsertContact({ email: "jan@example.com" })
    ).rejects.toMatchObject({
      statusCode: 503,
      code: "StorageNotConfigured"
    });
  });

  it("should_wrap_table_initialization_failures()", async function () {
    mockClient.createTable.mockRejectedValue({
      statusCode: 500,
      code: "ServerBusy",
      message: "storage unavailable"
    });

    await expect(
      MarketingContactRepository.upsertContact({ email: "jan@example.com" })
    ).rejects.toMatchObject({
      statusCode: 500,
      code: "ServerBusy",
      details: "storage unavailable"
    });
    expect(mockClient.upsertEntity).not.toHaveBeenCalled();
  });

  it("should_wrap_contact_write_failures_with_safe_defaults()", async function () {
    mockClient.upsertEntity.mockRejectedValue(new Error());

    await expect(
      MarketingContactRepository.upsertContact({ email: "jan@example.com" })
    ).rejects.toMatchObject({
      statusCode: 503,
      code: "StorageWriteFailed"
    });
  });
});