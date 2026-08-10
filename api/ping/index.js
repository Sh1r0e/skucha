const { rejectDuringMaintenance } = require("../helpers/maintenance");

module.exports = async function (context) {
  if (rejectDuringMaintenance(context)) {
    return;
  }

  context.res = {
    status: 200,
    headers: {
      "Content-Type": "application/json"
    },
    body: {
      ok: true,
      service: "skucha-api",
      timestamp: new Date().toISOString()
    }
  };
};
