const fs = require("fs/promises");
const path = require("path");

const CONFIG_CANDIDATES = [
  path.join(__dirname, "..", "..", "config", "config.json"),
  path.join(__dirname, "..", "config.json"),
  path.join(process.cwd(), "config", "config.json"),
  path.join(process.cwd(), "api", "config.json")
];

const DEFAULT_CONFIG = {
  contact: {
    phone: "+48 213 767 420",
    whatsapp: "+48 213 767 420",
    email: "kontakt@skucha.pl"
  },
  pricing: {
    weekday: 40,
    weekend: 45,
    deliveryPerPad: 15,
    currency: "PLN"
  },
  availability: {
    totalPads: 4,
    horizonMonths: 6
  },
  pickupPoints: [
    {
      name: "Stabłowice",
      address: "ul. Przykładowa 12, 54-100 Wrocław",
      enabled: true
    }
  ]
};

let cachedConfig = null;

function mergeConfig(base, extra) {
  return {
    ...base,
    ...(extra || {}),
    contact: {
      ...(base.contact || {}),
      ...((extra && extra.contact) || {})
    },
    pricing: {
      ...(base.pricing || {}),
      ...((extra && extra.pricing) || {})
    },
    availability: {
      ...(base.availability || {}),
      ...((extra && extra.availability) || {})
    },
    pickupPoints: Array.isArray(extra && extra.pickupPoints)
      ? extra.pickupPoints
      : base.pickupPoints
  };
}

async function tryReadJson(configPath) {
  const raw = await fs.readFile(configPath, "utf8");
  return JSON.parse(raw);
}

async function loadConfig() {
  if (cachedConfig) {
    return cachedConfig;
  }

  for (const candidate of CONFIG_CANDIDATES) {
    try {
      const parsed = await tryReadJson(candidate);
      cachedConfig = mergeConfig(DEFAULT_CONFIG, parsed);
      return cachedConfig;
    } catch (error) {
      // Try next location.
    }
  }

  cachedConfig = DEFAULT_CONFIG;
  return cachedConfig;
}

module.exports = {
  loadConfig
};
