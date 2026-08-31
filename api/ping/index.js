const { rejectDuringMaintenance } = require("../helpers/maintenance");
const { jsonResponse } = require("../helpers/http");

module.exports = async function (context) {
  if (rejectDuringMaintenance(context)) {
    return;
  }

  context.res = jsonResponse(200, {
      ok: true,
      service: "skucha-api",
      timestamp: new Date().toISOString()
    });
};
