const ReservationIdempotencyRepository = require("../../../repositories/ReservationIdempotencyRepository");

describe("ReservationIdempotencyRepository", function () {
  let mockClient;

  beforeEach(function () {
    mockClient = {
      createTable: vi.fn().mockResolvedValue(undefined),
      createEntity: vi.fn().mockResolvedValue(undefined),
      getEntity: vi.fn(),
      updateEntity: vi.fn().mockResolvedValue({ etag: "etag-new" })
    };

    ReservationIdempotencyRepository.__resetDependencies();
    ReservationIdempotencyRepository.__setDependencies({
      TableClient: {
        fromConnectionString: vi.fn().mockReturnValue(mockClient)
      },
      ConfigurationService: {
        getStorageConnectionString: vi.fn().mockReturnValue("UseDevelopmentStorage=true")
      },
      now: vi.fn().mockReturnValue(new Date("2026-08-17T10:00:00.000Z"))
    });
    vi.clearAllMocks();
  });

  it("should_claim_a_new_idempotency_key()", async function () {
    const result = await ReservationIdempotencyRepository.claimRequest(
      "request-123",
      "fingerprint-1",
      new Date("2026-08-17T10:00:00.000Z")
    );

    expect(result).toMatchObject({ claimed: true });
    expect(mockClient.createEntity).toHaveBeenCalledWith(expect.objectContaining({
      partitionKey: "Reservation",
      Fingerprint: "fingerprint-1",
      Status: "Processing",
      ResponseJson: ""
    }));
  });

  it("should_reject_claims_when_storage_is_not_configured()", async function () {
    ReservationIdempotencyRepository.__setDependencies({
      ConfigurationService: {
        getStorageConnectionString: vi.fn().mockReturnValue("")
      }
    });

    await expect(
      ReservationIdempotencyRepository.claimRequest("request-123", "fingerprint-1")
    ).rejects.toMatchObject({ statusCode: 503, code: "StorageNotConfigured" });
  });

  it("should_ignore_an_existing_idempotency_table_during_initialization()", async function () {
    mockClient.createTable.mockRejectedValue(Object.assign(new Error("exists"), { statusCode: 409 }));

    await expect(
      ReservationIdempotencyRepository.claimRequest("request-123", "fingerprint-1")
    ).resolves.toMatchObject({ claimed: true });
  });

  it("should_wrap_idempotency_table_initialization_failures()", async function () {
    mockClient.createTable.mockRejectedValue(Object.assign(new Error("init failed"), {
      statusCode: 500,
      code: "EINIT"
    }));

    await expect(
      ReservationIdempotencyRepository.claimRequest("request-123", "fingerprint-1")
    ).rejects.toMatchObject({ statusCode: 500, code: "EINIT" });
  });

  it("should_wrap_non_conflict_claim_write_failures()", async function () {
    mockClient.createEntity.mockRejectedValue(Object.assign(new Error("write failed"), {
      statusCode: 502,
      code: "EWRITE"
    }));

    await expect(
      ReservationIdempotencyRepository.claimRequest("request-123", "fingerprint-1")
    ).rejects.toMatchObject({ statusCode: 502, code: "EWRITE" });
  });

  it("should_report_a_claim_race_when_the_conflicting_entity_is_missing()", async function () {
    mockClient.createEntity.mockRejectedValue(Object.assign(new Error("exists"), { statusCode: 409 }));
    mockClient.getEntity.mockRejectedValue(Object.assign(new Error("missing"), { statusCode: 404 }));

    await expect(
      ReservationIdempotencyRepository.claimRequest("request-123", "fingerprint-1")
    ).rejects.toMatchObject({ statusCode: 503, code: "IdempotencyClaimRace" });
  });

  it("should_wrap_idempotency_record_read_failures()", async function () {
    mockClient.createEntity.mockRejectedValue(Object.assign(new Error("exists"), { statusCode: 409 }));
    mockClient.getEntity.mockRejectedValue(Object.assign(new Error("read failed"), {
      statusCode: 502,
      code: "EREAD"
    }));

    await expect(
      ReservationIdempotencyRepository.claimRequest("request-123", "fingerprint-1")
    ).rejects.toMatchObject({ statusCode: 502, code: "EREAD" });
  });

  it("should_return_the_completed_response_for_a_matching_retry()", async function () {
    mockClient.createEntity.mockRejectedValue(Object.assign(new Error("exists"), { statusCode: 409 }));
    mockClient.getEntity.mockResolvedValue({
      etag: "etag-completed",
      Fingerprint: "fingerprint-1",
      Status: "Completed",
      ResponseJson: JSON.stringify({ reservationId: "res-1" })
    });

    const result = await ReservationIdempotencyRepository.claimRequest("request-123", "fingerprint-1");

    expect(result).toMatchObject({
      completed: true,
      response: { reservationId: "res-1" },
      etag: "etag-completed"
    });
  });

  it("should_reject_a_completed_retry_with_an_invalid_stored_response()", async function () {
    mockClient.createEntity.mockRejectedValue(Object.assign(new Error("exists"), { statusCode: 409 }));
    mockClient.getEntity.mockResolvedValue({
      Fingerprint: "fingerprint-1",
      Status: "Completed",
      ResponseJson: "not-json"
    });

    await expect(
      ReservationIdempotencyRepository.claimRequest("request-123", "fingerprint-1")
    ).rejects.toMatchObject({ statusCode: 503, code: "IdempotencyResponseInvalid" });
  });

  it("should_reject_a_retry_for_a_failed_request()", async function () {
    mockClient.createEntity.mockRejectedValue(Object.assign(new Error("exists"), { statusCode: 409 }));
    mockClient.getEntity.mockResolvedValue({
      Fingerprint: "fingerprint-1",
      Status: "Failed"
    });

    await expect(
      ReservationIdempotencyRepository.claimRequest("request-123", "fingerprint-1")
    ).rejects.toMatchObject({ statusCode: 409, code: "IdempotencyRequestFailed" });
  });

  it("should_reject_a_retry_while_the_original_request_is_processing()", async function () {
    mockClient.createEntity.mockRejectedValue(Object.assign(new Error("exists"), { statusCode: 409 }));
    mockClient.getEntity.mockResolvedValue({
      Fingerprint: "fingerprint-1",
      Status: "Processing"
    });

    await expect(
      ReservationIdempotencyRepository.claimRequest("request-123", "fingerprint-1")
    ).rejects.toMatchObject({ statusCode: 409, code: "IdempotencyRequestInProgress" });
  });

  it("should_reject_reuse_of_a_key_with_a_different_payload()", async function () {
    mockClient.createEntity.mockRejectedValue(Object.assign(new Error("exists"), { statusCode: 409 }));
    mockClient.getEntity.mockResolvedValue({
      Fingerprint: "different-fingerprint",
      Status: "Processing"
    });

    await expect(
      ReservationIdempotencyRepository.claimRequest("request-123", "fingerprint-1")
    ).rejects.toMatchObject({ statusCode: 409, code: "IdempotencyKeyReuse" });
  });

  it("should_complete_a_claimed_request_with_a_serialized_response()", async function () {
    mockClient.getEntity.mockResolvedValue({
      etag: "etag-old",
      Status: "Processing"
    });

    const result = await ReservationIdempotencyRepository.completeRequest(
      "request-123",
      { reservationId: "res-1", payment: { status: "unpaid" } }
    );

    expect(result).toMatchObject({ completed: true, etag: "etag-new" });
    expect(mockClient.updateEntity).toHaveBeenCalledWith(
      expect.objectContaining({
        Status: "Completed",
        ResponseJson: JSON.stringify({ reservationId: "res-1", payment: { status: "unpaid" } })
      }),
      "Merge",
      { etag: "etag-old" }
    );
  });

  it("should_report_completion_when_the_claimed_record_is_missing()", async function () {
    mockClient.getEntity.mockResolvedValue(null);

    await expect(
      ReservationIdempotencyRepository.completeRequest("request-123", { reservationId: "res-1" })
    ).rejects.toMatchObject({ statusCode: 503, code: "IdempotencyRecordNotFound" });
  });

  it("should_complete_without_an_etag_when_storage_does_not_return_one()", async function () {
    mockClient.getEntity.mockResolvedValue({ Status: "Processing" });
    mockClient.updateEntity.mockResolvedValue({});

    const result = await ReservationIdempotencyRepository.completeRequest(
      "request-123",
      { reservationId: "res-1" }
    );

    expect(result).toMatchObject({ completed: true, etag: "" });
    expect(mockClient.updateEntity).toHaveBeenCalledWith(
      expect.objectContaining({ Status: "Completed" }),
      "Merge"
    );
  });

  it("should_report_a_completion_etag_conflict()", async function () {
    mockClient.getEntity.mockResolvedValue({ etag: "etag-old", Status: "Processing" });
    mockClient.updateEntity.mockRejectedValue(Object.assign(new Error("changed"), { statusCode: 412 }));

    await expect(
      ReservationIdempotencyRepository.completeRequest("request-123", { reservationId: "res-1" })
    ).rejects.toMatchObject({ statusCode: 409, code: "IdempotencyConflict" });
  });

  it("should_wrap_other_completion_update_failures()", async function () {
    mockClient.getEntity.mockResolvedValue({ etag: "etag-old", Status: "Processing" });
    mockClient.updateEntity.mockRejectedValue(Object.assign(new Error("update failed"), {
      statusCode: 500,
      code: "EUPDATE"
    }));

    await expect(
      ReservationIdempotencyRepository.completeRequest("request-123", { reservationId: "res-1" })
    ).rejects.toMatchObject({ statusCode: 500, code: "EUPDATE" });
  });

  it("should_mark_a_failed_request_for_retry_diagnostics()", async function () {
    mockClient.getEntity.mockResolvedValue({
      etag: "etag-old",
      Status: "Processing"
    });

    const result = await ReservationIdempotencyRepository.failRequest(
      "request-123",
      Object.assign(new Error("Stripe unavailable"), { code: "StripeUnavailable" })
    );

    expect(result).toMatchObject({ failed: true, etag: "etag-new" });
    expect(mockClient.updateEntity).toHaveBeenCalledWith(
      expect.objectContaining({ Status: "Failed", ErrorCode: "StripeUnavailable" }),
      "Merge",
      { etag: "etag-old" }
    );
  });

  it("should_ignore_failure_marking_when_the_record_is_missing_or_completed()", async function () {
    mockClient.getEntity.mockResolvedValueOnce(null);
    await expect(
      ReservationIdempotencyRepository.failRequest("request-123", new Error("failed"))
    ).resolves.toBeNull();

    mockClient.getEntity.mockResolvedValueOnce({ Status: "Completed" });
    await expect(
      ReservationIdempotencyRepository.failRequest("request-123", new Error("failed"))
    ).resolves.toBeNull();
  });

  it("should_mark_failure_without_an_etag_when_storage_does_not_return_one()", async function () {
    mockClient.getEntity.mockResolvedValue({ Status: "Processing" });
    mockClient.updateEntity.mockResolvedValue({});

    const result = await ReservationIdempotencyRepository.failRequest("request-123", {});

    expect(result).toMatchObject({ failed: true, etag: "" });
    expect(mockClient.updateEntity).toHaveBeenCalledWith(
      expect.objectContaining({ Status: "Failed", ErrorCode: "ReservationFailed" }),
      "Merge"
    );
  });

  it("should_wrap_failure_update_errors()", async function () {
    mockClient.getEntity.mockResolvedValue({ etag: "etag-old", Status: "Processing" });
    mockClient.updateEntity.mockRejectedValue(Object.assign(new Error("update failed"), {
      statusCode: 500,
      code: "EUPDATE"
    }));

    await expect(
      ReservationIdempotencyRepository.failRequest("request-123", new Error("failed"))
    ).rejects.toMatchObject({ statusCode: 500, code: "EUPDATE" });
  });
});