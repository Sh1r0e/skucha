const fs = require("fs/promises");
const path = require("path");

const CONFIG_PATH = path.join(__dirname, "..", "..", "config", "config.json");

let cachedConfig = null;

async function loadConfig() {
  if (cachedConfig) {
    return cachedConfig;
  }

  const raw = await fs.readFile(CONFIG_PATH, "utf8");
  cachedConfig = JSON.parse(raw);
  return cachedConfig;
}

module.exports = {
  loadConfig
};
