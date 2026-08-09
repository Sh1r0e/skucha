const ConfigurationService = require("../services/ConfigurationService");

const MAINTENANCE_MESSAGE = "Service temporarily unavailable while the site is being built.";

function rejectDuringMaintenance(context) {
  if (!ConfigurationService.getMaintenanceMode()) {
    return false;
  }

  context.res = {
    status: 503,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "Retry-After": "3600"
    },
    body: {
      message: MAINTENANCE_MESSAGE,
      code: "MaintenanceMode"
    }
  };

  return true;
}

module.exports = {
  MAINTENANCE_MESSAGE,
  rejectDuringMaintenance
};
