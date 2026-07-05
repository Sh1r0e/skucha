function createMockContext(overrides) {
  const logs = [];

  return {
    invocationId: "test-invocation-id",
    req: undefined,
    res: undefined,
    log: Object.assign(
      function log() {
        logs.push(Array.from(arguments));
      },
      {
        error: function error() {
          logs.push(Array.from(arguments));
        }
      }
    ),
    _logs: logs,
    ...overrides
  };
}

function createAsyncIterable(items) {
  return {
    [Symbol.asyncIterator]: async function* asyncIterator() {
      for (const item of items) {
        yield item;
      }
    }
  };
}

module.exports = {
  createMockContext,
  createAsyncIterable
};
