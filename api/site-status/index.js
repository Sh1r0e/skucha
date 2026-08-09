const ConfigurationService = require("../services/ConfigurationService");
const { MAINTENANCE_MESSAGE } = require("../helpers/maintenance");

module.exports = async function (context) {
  const maintenanceMode = ConfigurationService.getMaintenanceMode();

  context.res = {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store, max-age=0",
      "Pragma": "no-cache"
    },
    body: {
      maintenanceMode,
      message: maintenanceMode ? MAINTENANCE_MESSAGE : ""
    }
  };
};
