const ConfigurationService = require("../services/ConfigurationService");
const { MAINTENANCE_MESSAGE } = require("../helpers/maintenance");
const { jsonResponse } = require("../helpers/http");

module.exports = async function (context) {
  const maintenanceMode = ConfigurationService.getMaintenanceMode();

  context.res = jsonResponse(200, {
      maintenanceMode,
      message: maintenanceMode ? MAINTENANCE_MESSAGE : ""
    }, { "Cache-Control": "no-store, max-age=0" });
};
