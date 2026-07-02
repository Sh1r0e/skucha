module.exports = async function (context) {
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
