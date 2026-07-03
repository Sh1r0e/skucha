function getStorageConnectionString() {
  return process.env.STORAGE_CONNECTION_STRING;
}

module.exports = {
  getStorageConnectionString
};
