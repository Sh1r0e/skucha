const ConfigurationService = require("../../../services/ConfigurationService");

describe("ConfigurationService", function () {
  it("should_return_storage_connection_string_from_environment()", function () {
    process.env.STORAGE_CONNECTION_STRING = "UseDevelopmentStorage=true";

    const value = ConfigurationService.getStorageConnectionString();

    expect(value).toBe("UseDevelopmentStorage=true");
  });

  it("should_return_undefined_when_storage_connection_string_is_missing()", function () {
    delete process.env.STORAGE_CONNECTION_STRING;

    const value = ConfigurationService.getStorageConnectionString();

    expect(value).toBeUndefined();
  });
});
