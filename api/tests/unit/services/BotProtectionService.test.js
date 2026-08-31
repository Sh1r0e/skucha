const BotProtectionService = require("../../../services/BotProtectionService");

describe("BotProtectionService", function () {
  it("should_hash_the_client_address_and_apply_the_route_policy", async function () {
    const repository = { consume: vi.fn().mockResolvedValue({ allowed: true, remaining: 9 }) };
    const service = BotProtectionService.createBotProtectionService({
      RateLimitRepository: repository,
      ConfigurationService: { getRateLimitHashSecret: vi.fn().mockReturnValue("hash-secret") }
    });

    await service.checkRequest({ headers: { "x-forwarded-for": "198.51.100.4, 203.0.113.8" } }, "reservation-create");

    expect(repository.consume).toHaveBeenCalledWith(
      "reservation-create",
      expect.stringMatching(/^[a-f0-9]{64}$/),
      10,
      300
    );
    expect(repository.consume.mock.calls[0][1]).not.toContain("203.0.113.8");
  });

  it("should_normalize_supported_proxy_address_headers", function () {
    expect(BotProtectionService.getClientAddress({ headers: { "x-forwarded-for": "bad, [2001:db8::1]:443" } }))
      .toBe("2001:db8::1");
    expect(BotProtectionService.getClientAddress({ headers: { "x-real-ip": "192.0.2.4:1234" } }))
      .toBe("192.0.2.4");
    expect(BotProtectionService.getClientAddress({ headers: {} })).toBe("unknown");
  });

  it("should_skip_unconfigured_limits_outside_production", async function () {
    const service = BotProtectionService.createBotProtectionService({
      ConfigurationService: { getRateLimitHashSecret: vi.fn().mockReturnValue("") }
    });

    await expect(service.checkRequest({ headers: {} }, "availability"))
      .resolves.toEqual({ allowed: true, skipped: true });
  });
});