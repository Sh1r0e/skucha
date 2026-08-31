const fs = require("fs");
const path = require("path");
const { createMockContext } = require("../../helpers/functionTestUtils");

const newBookingHandlers = [
  require("../../../availability"),
  require("../../../reservation")
];

const apiRoot = path.resolve(__dirname, "../../..");

function findOperationalHandlers(directory) {
  const handlers = [];

  fs.readdirSync(directory, { withFileTypes: true }).forEach(function (entry) {
    if (!entry.isDirectory() || ["node_modules", "coverage", "tests"].includes(entry.name)) {
      return;
    }

    const childDirectory = path.join(directory, entry.name);
    const functionPath = path.join(childDirectory, "function.json");
    const entrypoint = path.join(childDirectory, "index.js");

    if (fs.existsSync(functionPath) && fs.existsSync(entrypoint)) {
      const functionConfig = JSON.parse(fs.readFileSync(functionPath, "utf8"));
      const trigger = functionConfig.bindings.find(function (binding) {
        return binding.type === "httpTrigger";
      });

      if (trigger && trigger.route !== "site-status") {
        handlers.push(require(entrypoint));
      }
    }

    handlers.push(...findOperationalHandlers(childDirectory));
  });

  return handlers;
}

const operationalHandlers = findOperationalHandlers(apiRoot);

describe("maintenance mode public API policy", function () {
  const previous = process.env.MAINTENANCE_MODE;

  afterEach(function () {
    if (previous === undefined) {
      delete process.env.MAINTENANCE_MODE;
    } else {
      process.env.MAINTENANCE_MODE = previous;
    }
  });

  it("should_block_new_booking_operations_during_maintenance()", async function () {
    process.env.MAINTENANCE_MODE = "true";

    for (const handler of newBookingHandlers) {
      const context = createMockContext();

      await handler(context, { body: {}, query: {} });

      expect(context.res.status).toBe(503);
      expect(context.res.body.code).toBe("MaintenanceMode");
    }
  });

  it("should_block_every_operational_API_endpoint_during_maintenance()", async function () {
    process.env.MAINTENANCE_MODE = "true";

    for (const handler of operationalHandlers) {
      const context = createMockContext();

      await handler(context, { body: {}, query: {}, headers: {}, method: "GET" });

      expect(context.res.status).toBe(503);
      expect(context.res.body.code).toBe("MaintenanceMode");
    }
  });

  it("should_allow_operational_handlers_to_run_when_maintenance_is_disabled()", async function () {
    delete process.env.MAINTENANCE_MODE;

    for (const handler of operationalHandlers) {
      const context = createMockContext();

      await handler(context, { body: {}, query: {}, headers: {}, method: "POST" });

      expect(context.res).toBeDefined();
      expect(context.res.body && context.res.body.code).not.toBe("MaintenanceMode");
    }
  });
});
