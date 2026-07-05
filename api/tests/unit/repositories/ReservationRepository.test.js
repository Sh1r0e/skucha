const { createAsyncIterable } = require("../../helpers/functionTestUtils");
const ReservationRepository = require("../../../repositories/ReservationRepository");

describe("ReservationRepository", function () {
  let mockClient;

  beforeEach(function () {
    mockClient = {
      createTable: vi.fn().mockResolvedValue(undefined),
      createEntity: vi.fn().mockResolvedValue(undefined),
      updateEntity: vi.fn().mockResolvedValue(undefined),
      listEntities: vi.fn().mockReturnValue(createAsyncIterable([]))
    };

    ReservationRepository.__resetDependencies();
    ReservationRepository.__setDependencies({
      TableClient: {
        fromConnectionString: vi.fn().mockReturnValue(mockClient)
      },
      uuidv4: vi.fn().mockReturnValue("fixed-uuid-1"),
      odata: function odata(strings) {
        const values = Array.prototype.slice.call(arguments, 1);
        return strings.reduce(function (acc, part, index) {
          const value = values[index] == null ? "" : values[index];
          return acc + part + value;
        }, "");
      },
      ConfigurationService: {
        getStorageConnectionString: vi.fn().mockReturnValue("UseDevelopmentStorage=true")
      }
    });
    vi.clearAllMocks();
  });

  it("should_saveReservation_with_correct_entity_mapping_and_keys()", async function () {
    const result = await ReservationRepository.saveReservation({
      fullName: "Jan Kowalski",
      email: "jan@example.com",
      phone: "+48500500500",
      dateFrom: "2026-08-10",
      dateTo: "2026-08-12",
      padsCount: 3,
      notes: "test",
      status: "Pending"
    });

    expect(mockClient.createEntity).toHaveBeenCalledTimes(1);
    expect(mockClient.createEntity.mock.calls[0][0]).toMatchObject({
      partitionKey: "2026-08",
      rowKey: "fixed-uuid-1",
      Status: "Pending",
      CustomerName: "Jan Kowalski",
      CustomerEmail: "jan@example.com",
      CustomerPhone: "+48500500500",
      FromDate: "2026-08-10",
      ToDate: "2026-08-12",
      Pads: 3,
      Notes: "test"
    });
    expect(result.id).toBe("fixed-uuid-1");
  });

  it("should_getReservation_by_row_key()", async function () {
    mockClient.listEntities.mockReturnValue(
      createAsyncIterable([
        {
          partitionKey: "2026-08",
          rowKey: "res-22",
          Status: "Pending",
          CustomerName: "Jan Kowalski",
          CustomerEmail: "jan@example.com",
          CustomerPhone: "+48500500500",
          FromDate: "2026-08-10",
          ToDate: "2026-08-12",
          Pads: 2,
          Notes: "",
          CreatedAt: "2026-07-05T10:00:00.000Z"
        }
      ])
    );

    const result = await ReservationRepository.getReservation("res-22");

    expect(mockClient.listEntities).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      id: "res-22",
      partitionKey: "2026-08",
      customerName: "Jan Kowalski",
      pads: 2
    });
  });

  it("should_getReservations_as_public_entities()", async function () {
    mockClient.listEntities.mockReturnValue(
      createAsyncIterable([
        {
          partitionKey: "2026-08",
          rowKey: "res-1",
          Status: "Pending",
          CustomerName: "A",
          CustomerEmail: "a@example.com",
          CustomerPhone: "+48000000001",
          FromDate: "2026-08-10",
          ToDate: "2026-08-11",
          Pads: 1,
          Notes: "",
          CreatedAt: "2026-07-05T10:00:00.000Z"
        },
        {
          partitionKey: "2026-08",
          rowKey: "res-2",
          Status: "Confirmed",
          CustomerName: "B",
          CustomerEmail: "b@example.com",
          CustomerPhone: "+48000000002",
          FromDate: "2026-08-12",
          ToDate: "2026-08-13",
          Pads: 2,
          Notes: "",
          CreatedAt: "2026-07-05T10:00:00.000Z"
        }
      ])
    );

    const result = await ReservationRepository.getReservations();

    expect(result).toHaveLength(2);
    expect(result[0].id).toBe("res-1");
    expect(result[1].status).toBe("Confirmed");
  });

  it("should_updateStatus_for_existing_reservation()", async function () {
    mockClient.listEntities.mockReturnValue(
      createAsyncIterable([
        {
          partitionKey: "2026-08",
          rowKey: "res-2",
          Status: "Pending",
          CustomerName: "B",
          CustomerEmail: "b@example.com",
          CustomerPhone: "+48000000002",
          FromDate: "2026-08-12",
          ToDate: "2026-08-13",
          Pads: 2,
          Notes: "",
          CreatedAt: "2026-07-05T10:00:00.000Z"
        }
      ])
    );

    const updated = await ReservationRepository.updateStatus("res-2", "Confirmed");

    expect(mockClient.updateEntity).toHaveBeenCalledWith(
      {
        partitionKey: "2026-08",
        rowKey: "res-2",
        Status: "Confirmed"
      },
      "Merge"
    );
    expect(updated.status).toBe("Confirmed");
  });

  it("should_return_null_when_updateStatus_target_does_not_exist()", async function () {
    mockClient.listEntities.mockReturnValue(createAsyncIterable([]));

    const result = await ReservationRepository.updateStatus("missing", "Confirmed");

    expect(result).toBeNull();
    expect(mockClient.updateEntity).not.toHaveBeenCalled();
  });

  it("should_throw_wrapped_error_when_storage_write_fails()", async function () {
    mockClient.createEntity.mockRejectedValue(Object.assign(new Error("network"), { statusCode: 500, code: "EFAIL" }));

    await expect(
      ReservationRepository.saveReservation({
        fullName: "Jan Kowalski",
        email: "jan@example.com",
        phone: "+48500500500",
        dateFrom: "2026-08-10",
        dateTo: "2026-08-12",
        padsCount: 2,
        status: "Pending"
      })
    ).rejects.toMatchObject({
      statusCode: 500,
      code: "EFAIL",
      message: "Unable to save reservation"
    });
  });

  it("should_throw_when_status_is_invalid()", async function () {
    await expect(
      ReservationRepository.saveReservation({
        fullName: "Jan Kowalski",
        email: "jan@example.com",
        phone: "+48500500500",
        dateFrom: "2026-08-10",
        dateTo: "2026-08-12",
        padsCount: 2,
        status: "UnknownStatus"
      })
    ).rejects.toMatchObject({
      statusCode: 400,
      message: "Invalid reservation status"
    });
  });

  it("should_throw_when_storage_is_not_configured()", async function () {
    ReservationRepository.__setDependencies({
      ConfigurationService: {
        getStorageConnectionString: vi.fn().mockReturnValue("")
      }
    });

    await expect(
      ReservationRepository.getReservations()
    ).rejects.toMatchObject({
      statusCode: 503,
      code: "StorageNotConfigured"
    });
  });

  it("should_wrap_error_when_table_initialization_fails()", async function () {
    mockClient.createTable.mockRejectedValue(Object.assign(new Error("init failed"), { statusCode: 500, code: "EINIT" }));

    await expect(
      ReservationRepository.getReservations()
    ).rejects.toMatchObject({
      statusCode: 500,
      code: "EINIT",
      message: "Unable to initialize reservations table"
    });
  });

  it("should_ignore_conflict_when_table_already_exists()", async function () {
    mockClient.createTable.mockRejectedValue(Object.assign(new Error("exists"), { statusCode: 409 }));

    await expect(ReservationRepository.getReservations()).resolves.toEqual([]);
  });

  it("should_wrap_error_when_getReservation_read_fails()", async function () {
    mockClient.listEntities.mockImplementation(function () {
      throw Object.assign(new Error("read fail"), { statusCode: 502, code: "EREAD" });
    });

    await expect(ReservationRepository.getReservation("id-1")).rejects.toMatchObject({
      statusCode: 502,
      code: "EREAD",
      message: "Unable to load reservation"
    });
  });

  it("should_wrap_error_when_getReservations_read_fails()", async function () {
    mockClient.listEntities.mockImplementation(function () {
      throw Object.assign(new Error("read fail"), { statusCode: 502, code: "EREADS" });
    });

    await expect(ReservationRepository.getReservations()).rejects.toMatchObject({
      statusCode: 502,
      code: "EREADS",
      message: "Unable to load reservations"
    });
  });

  it("should_wrap_error_when_update_status_fails()", async function () {
    mockClient.listEntities.mockReturnValue(
      createAsyncIterable([
        {
          partitionKey: "2026-08",
          rowKey: "res-2",
          Status: "Pending",
          CustomerName: "B",
          CustomerEmail: "b@example.com",
          CustomerPhone: "+48000000002",
          FromDate: "2026-08-12",
          ToDate: "2026-08-13",
          Pads: 2,
          Notes: "",
          CreatedAt: "2026-07-05T10:00:00.000Z"
        }
      ])
    );
    mockClient.updateEntity.mockRejectedValue(Object.assign(new Error("update failed"), { statusCode: 500, code: "EUPD" }));

    await expect(ReservationRepository.updateStatus("res-2", "Confirmed")).rejects.toMatchObject({
      statusCode: 500,
      code: "EUPD",
      message: "Unable to update reservation status"
    });
  });

  it("should_generate_fallback_partition_key_for_invalid_date()", async function () {
    await ReservationRepository.saveReservation({
      fullName: "Jan Kowalski",
      email: "jan@example.com",
      phone: "+48500500500",
      dateFrom: "invalid-date",
      dateTo: "2026-08-12",
      padsCount: 2,
      status: "Pending"
    });

    expect(mockClient.createEntity.mock.calls[0][0].partitionKey).toMatch(/^\d{4}-\d{2}$/);
  });
});
