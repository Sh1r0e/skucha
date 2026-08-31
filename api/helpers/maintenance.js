const ConfigurationService = require("../services/ConfigurationService");
const { jsonResponse } = require("./http");

const MAINTENANCE_MESSAGE = "Service temporarily unavailable while the site is being built.";

function rejectDuringMaintenance(context) {
  if (!ConfigurationService.getMaintenanceMode()) {
    return false;
  }

  context.res = jsonResponse(503, {
      message: MAINTENANCE_MESSAGE,
      code: "MaintenanceMode"
    }, { "Retry-After": "3600" });

  return true;
}

module.exports = {
  MAINTENANCE_MESSAGE,
  rejectDuringMaintenance
};
