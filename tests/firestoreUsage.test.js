const assert = require("assert");
const {
  FIRESTORE_METRICS,
  getFirestoreUsage,
  getPacificDayStart,
  getUsageStatus,
  hourlyDeltaTimeSeries,
  labelDeltaTimeSeries,
  resetUsageCache,
} = require("../functions/firestoreUsage");

function metricPoint(iso, value) {
  return {
    interval: {
      endTime: {
        seconds: String(Math.floor(Date.parse(iso) / 1000)),
        nanos: 0,
      },
    },
    value: {
      int64Value: String(value),
    },
  };
}

function metricTypeFromRequest(request) {
  const match = request.filter.match(/metric\.type = "([^"]+)"/);
  return match?.[1];
}

async function testUsageAggregation() {
  resetUsageCache();
  const requests = [];
  const client = {
    projectPath: (projectId) => `projects/${projectId}`,
    listTimeSeries: async (request) => {
      requests.push(request);
      const metricType = metricTypeFromRequest(request);

      if (metricType === FIRESTORE_METRICS.reads) {
        return [[{
          points: [
            metricPoint("2026-08-25T07:01:00.000Z", 12),
            metricPoint("2026-08-25T17:01:00.000Z", 8),
          ],
        }]];
      }

      if (metricType === FIRESTORE_METRICS.writes) {
        return [[{
          points: [metricPoint("2026-08-25T17:02:00.000Z", 4)],
        }]];
      }

      return [[
        {
          points: [metricPoint("2026-08-25T16:00:00.000Z", 200 * 1024 * 1024)],
        },
        {
          points: [metricPoint("2026-08-25T17:03:00.000Z", 100 * 1024 * 1024)],
        },
      ]];
    },
  };

  const usage = await getFirestoreUsage({
    client,
    projectId: "test-project",
    now: new Date("2026-08-25T18:00:00.000Z"),
  });

  assert.strictEqual(requests.length, 3);
  assert.strictEqual(usage.reads.usedToday, 20);
  assert.strictEqual(usage.writes.usedToday, 4);
  assert.strictEqual(usage.storage.usedBytes, 300 * 1024 * 1024);
  assert.strictEqual(usage.reads.status, "normal");
  assert.strictEqual(usage.writes.status, "normal");
  assert.strictEqual(usage.storage.status, "normal");
  assert.strictEqual(usage.periodStart, "2026-08-25T07:00:00.000Z");
  assert.strictEqual(usage.periodTimeZone, "America/Los_Angeles");

  const readRequest = requests.find((request) => metricTypeFromRequest(request) === FIRESTORE_METRICS.reads);
  assert.strictEqual(readRequest.interval.startTime.seconds, 1787641200);
}

async function testUnavailableMetricDoesNotHideHealthyMetrics() {
  resetUsageCache();
  const client = {
    projectPath: (projectId) => `projects/${projectId}`,
    listTimeSeries: async (request) => {
      const metricType = metricTypeFromRequest(request);
      if (metricType === FIRESTORE_METRICS.storage) {
        throw new Error("storage metric unavailable");
      }
      return [[{ points: [metricPoint("2026-08-25T17:00:00.000Z", 1)] }]];
    },
  };

  const usage = await getFirestoreUsage({
    client,
    projectId: "test-project",
    now: new Date("2026-08-25T18:00:00.000Z"),
  });

  assert.strictEqual(usage.reads.available, true);
  assert.strictEqual(usage.writes.available, true);
  assert.strictEqual(usage.storage.available, false);
  assert.strictEqual(usage.storage.status, "unavailable");
  assert.strictEqual(usage.storage.usedBytes, null);
}

function testPacificDayAndStatuses() {
  assert.strictEqual(
    getPacificDayStart(new Date("2026-01-15T18:00:00.000Z")).toISOString(),
    "2026-01-15T08:00:00.000Z"
  );
  assert.strictEqual(
    getPacificDayStart(new Date("2026-03-08T18:00:00.000Z")).toISOString(),
    "2026-03-08T08:00:00.000Z"
  );
  assert.strictEqual(
    getPacificDayStart(new Date("2026-11-01T18:00:00.000Z")).toISOString(),
    "2026-11-01T07:00:00.000Z"
  );
  assert.strictEqual(getUsageStatus(69.9), "normal");
  assert.strictEqual(getUsageStatus(70), "warning");
  assert.strictEqual(getUsageStatus(89.9), "warning");
  assert.strictEqual(getUsageStatus(90), "critical");
}

function testHourlyAndLabels() {
  const start = new Date("2026-08-25T07:00:00.000Z");
  const now = new Date("2026-08-25T09:30:00.000Z");
  const series = [
    { metric: { labels: { type: "QUERY" } }, points: [metricPoint("2026-08-25T07:01:00.000Z", 5), metricPoint("2026-08-25T08:00:00.000Z", 7), metricPoint("2026-08-25T09:10:00.000Z", 40)] },
    { metric: { labels: { type: "LOOKUP" } }, points: [metricPoint("2026-08-25T08:30:00.000Z", 3)] },
  ];
  const hourly = hourlyDeltaTimeSeries(series, start, now);
  assert.deepStrictEqual(hourly.map((bucket) => bucket.count), [12, 3, 40], "a point ending on the hour belongs to the hour before it");
  assert.strictEqual(hourly[0].startAt, "2026-08-25T07:00:00.000Z");
  assert.deepStrictEqual(labelDeltaTimeSeries(series), [{ labels: "type=QUERY", count: 52 }, { labels: "type=LOOKUP", count: 3 }]);
}

(async () => {
  testHourlyAndLabels();
  await testUsageAggregation();
  await testUnavailableMetricDoesNotHideHealthyMetrics();
  testPacificDayAndStatuses();
  console.log("firestoreUsage.test.js: all tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
