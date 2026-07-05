const ConfigService = require("../../../services/ConfigService");

describe("ConfigService", function () {
  beforeEach(function () {
    ConfigService.__resetDependencies();
    ConfigService.__resetCache();
    vi.clearAllMocks();
  });

  it("should_load_and_merge_configuration_from_candidate_file()", async function () {
    const readFile = vi.fn().mockResolvedValue(
      JSON.stringify({
        contact: { phone: "+48123123123" },
        availability: { totalPads: 8 },
        pickupPoints: [{ name: "Centrum", enabled: true }]
      })
    );

    ConfigService.__setDependencies({
      fs: { readFile },
      configCandidates: ["candidate-a"]
    });

    const config = await ConfigService.loadConfig();

    expect(config.contact.phone).toBe("+48123123123");
    expect(config.availability.totalPads).toBe(8);
    expect(config.pricing.weekday).toBe(40);
    expect(config.pickupPoints[0].name).toBe("Centrum");
  });

  it("should_fallback_to_default_configuration_when_all_candidates_fail()", async function () {
    const readFile = vi.fn().mockRejectedValue(new Error("ENOENT"));

    ConfigService.__setDependencies({
      fs: { readFile },
      configCandidates: ["candidate-a", "candidate-b"]
    });

    const config = await ConfigService.loadConfig();

    expect(readFile).toHaveBeenCalledTimes(2);
    expect(config.contact.email).toBe("kontakt@skucha.pl");
    expect(config.availability.totalPads).toBe(4);
  });

  it("should_try_next_candidate_after_read_or_parse_error()", async function () {
    const readFile = vi
      .fn()
      .mockResolvedValueOnce("{ bad-json")
      .mockResolvedValueOnce(JSON.stringify({ availability: { totalPads: 6 } }));

    ConfigService.__setDependencies({
      fs: { readFile },
      configCandidates: ["candidate-a", "candidate-b"]
    });

    const config = await ConfigService.loadConfig();

    expect(readFile).toHaveBeenCalledTimes(2);
    expect(config.availability.totalPads).toBe(6);
  });

  it("should_keep_default_pickup_points_when_override_is_not_array()", async function () {
    const readFile = vi.fn().mockResolvedValue(
      JSON.stringify({
        pickupPoints: "invalid"
      })
    );

    ConfigService.__setDependencies({
      fs: { readFile },
      configCandidates: ["candidate-a"]
    });

    const config = await ConfigService.loadConfig();

    expect(Array.isArray(config.pickupPoints)).toBe(true);
    expect(config.pickupPoints[0]).toHaveProperty("name");
  });

  it("should_cache_configuration_after_first_load()", async function () {
    const readFile = vi.fn().mockResolvedValue(JSON.stringify({ availability: { totalPads: 9 } }));

    ConfigService.__setDependencies({
      fs: { readFile },
      configCandidates: ["candidate-a"]
    });

    const first = await ConfigService.loadConfig();
    const second = await ConfigService.loadConfig();

    expect(first).toBe(second);
    expect(readFile).toHaveBeenCalledTimes(1);
  });
});
