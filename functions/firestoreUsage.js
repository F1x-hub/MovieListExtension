const monitoring = require("@google-cloud/monitoring");

const PACIFIC_TIME_ZONE = "America/Los_Angeles";
const STALE_AFTER_MS = 10 * 60 * 1000;
const CACHE_TTL_MS = 60 * 1000;

const FIRESTORE_FREE_LIMITS = Object.freeze({
  storageBytes: 1024 ** 3,
  readsPerDay: 50_000,
  writesPerDay: 20_000,
});

const FIRESTORE_METRICS = Object.freeze({
  reads: "firestore.googleapis.com/document/read_count",
  writes: "firestore.googleapis.com/document/write_count",
  storage: "firestore.googleapis.com/storage/data_and_index_storage_bytes",
});

let monitoringClient;
let usageCache = null;

function getMonitoringClient() {
  if (!monitoringClient) {
    monitoringClient = new monitoring.MetricServiceClient();
  }
  return monitoringClient;
}

function toMonitoringTimestamp(date) {
  const milliseconds = date.getTime();
  return {
    seconds: Math.floor(milliseconds / 1000),
    nanos: (milliseconds % 1000) * 1_000_000,
  };
}

function timestampToMilliseconds(timestamp) {
  if (!timestamp) return 0;
  if (typeof timestamp === "number") return timestamp * 1000;
  if (typeof timestamp === "string") {
    const parsed = Date.parse(timestamp);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  const rawSeconds = timestamp.seconds;
  const seconds = typeof rawSeconds?.toString === "function"
    ? Number(rawSeconds.toString())
    : Number(rawSeconds);
  const nanos = Number(timestamp.nanos || 0);

  if (!Number.isFinite(seconds)) return 0;
  return seconds * 1000 + nanos / 1_000_000;
}

function getTimeZoneOffsetMinutes(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "longOffset",
  }).formatToParts(date);
  const zoneName = parts.find((part) => part.type === "timeZoneName")?.value || "GMT";
  const match = zoneName.match(/^GMT([+-])(\d{1,2})(?::?(\d{2}))?$/);
  if (!match) return 0;

  const sign = match[1] === "-" ? -1 : 1;
  const hours = Number(match[2]);
  const minutes = Number(match[3] || 0);
  return sign * (hours * 60 + minutes);
}

function getPacificDayStart(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: PACIFIC_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const localMidnightAsUtc = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day)
  );

  // Resolve the offset at the candidate midnight. Looking up the offset at
  // noon is incorrect on DST transition days because the offset can change
  // between midnight and noon.
  let candidate = new Date(localMidnightAsUtc);
  for (let attempt = 0; attempt < 3; attempt++) {
    const offsetMinutes = getTimeZoneOffsetMinutes(candidate, PACIFIC_TIME_ZONE);
    const resolved = new Date(localMidnightAsUtc - offsetMinutes * 60 * 1000);
    if (resolved.getTime() === candidate.getTime()) return resolved;
    candidate = resolved;
  }

  return candidate;
}

function getPointValue(point) {
  const rawValue = point?.value?.int64Value ?? point?.value?.doubleValue;
  const value = Number(rawValue);
  return Number.isFinite(value) ? value : 0;
}

function getPointTimestamp(point) {
  return timestampToMilliseconds(point?.interval?.endTime || point?.interval?.startTime);
}

function sumDeltaTimeSeries(timeSeries = []) {
  let value = 0;
  let latestPointAt = 0;

  for (const series of timeSeries) {
    for (const point of series.points || []) {
      value += getPointValue(point);
      latestPointAt = Math.max(latestPointAt, getPointTimestamp(point));
    }
  }

  return { value: Math.max(0, Math.round(value)), latestPointAt };
}

function sumLatestGaugeTimeSeries(timeSeries = []) {
  let value = 0;
  let latestPointAt = 0;

  for (const series of timeSeries) {
    let latestPoint = null;
    let latestTimestamp = 0;

    for (const point of series.points || []) {
      const pointTimestamp = getPointTimestamp(point);
      if (pointTimestamp >= latestTimestamp) {
        latestTimestamp = pointTimestamp;
        latestPoint = point;
      }
    }

    if (latestPoint) {
      value += getPointValue(latestPoint);
      latestPointAt = Math.max(latestPointAt, latestTimestamp);
    }
  }

  return { value: Math.max(0, Math.round(value)), latestPointAt };
}

function getUsageStatus(percent) {
  if (percent >= 90) return "critical";
  if (percent >= 70) return "warning";
  return "normal";
}

function createAvailableMetric(used, limit, latestPointAt, measuredAt, valueKey) {
  const percent = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
  const roundedPercent = Math.round(percent * 10) / 10;
  const metric = {
    [valueKey]: used,
    limit,
    percent: roundedPercent,
    status: getUsageStatus(roundedPercent),
    available: true,
    stale: latestPointAt > 0 && measuredAt.getTime() - latestPointAt > STALE_AFTER_MS,
    latestPointAt: latestPointAt ? new Date(latestPointAt).toISOString() : null,
  };
  return metric;
}

function createUnavailableMetric(limit, valueKey) {
  return {
    [valueKey]: null,
    limit,
    percent: null,
    status: "unavailable",
    available: false,
    stale: true,
    latestPointAt: null,
  };
}

async function listMetricTimeSeries({ client, projectId, metricType, startTime, endTime }) {
  const projectName = typeof client.projectPath === "function"
    ? client.projectPath(projectId)
    : `projects/${projectId}`;
  const [timeSeries] = await client.listTimeSeries({
    name: projectName,
    filter: `metric.type = "${metricType}"`,
    interval: {
      startTime: toMonitoringTimestamp(startTime),
      endTime: toMonitoringTimestamp(endTime),
    },
    view: "FULL",
  });
  return timeSeries || [];
}

function getProjectId() {
  return process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;
}

async function getFirestoreUsage({
  client = getMonitoringClient(),
  projectId = getProjectId(),
  now = new Date(),
} = {}) {
  if (!projectId) {
    throw new Error("Google Cloud project ID is not configured");
  }

  if (!client || typeof client.listTimeSeries !== "function") {
    throw new Error("Cloud Monitoring client is not configured");
  }

  const measuredAt = now instanceof Date ? now : new Date(now);
  const cachedEntry = usageCache?.projectId === projectId ? usageCache : null;
  if (cachedEntry && measuredAt.getTime() - cachedEntry.createdAt < CACHE_TTL_MS) {
    return cachedEntry.value;
  }

  const periodStart = getPacificDayStart(measuredAt);
  const results = await Promise.allSettled([
    listMetricTimeSeries({
      client,
      projectId,
      metricType: FIRESTORE_METRICS.reads,
      startTime: periodStart,
      endTime: measuredAt,
    }),
    listMetricTimeSeries({
      client,
      projectId,
      metricType: FIRESTORE_METRICS.writes,
      startTime: periodStart,
      endTime: measuredAt,
    }),
    listMetricTimeSeries({
      client,
      projectId,
      metricType: FIRESTORE_METRICS.storage,
      startTime: new Date(measuredAt.getTime() - 24 * 60 * 60 * 1000),
      endTime: measuredAt,
    }),
  ]);

  const [readsResult, writesResult, storageResult] = results;
  const reads = readsResult.status === "fulfilled"
    ? sumDeltaTimeSeries(readsResult.value)
    : null;
  const writes = writesResult.status === "fulfilled"
    ? sumDeltaTimeSeries(writesResult.value)
    : null;
  const storage = storageResult.status === "fulfilled"
    ? sumLatestGaugeTimeSeries(storageResult.value)
    : null;

  const response = {
    source: "cloud-monitoring",
    measuredAt: measuredAt.toISOString(),
    periodStart: periodStart.toISOString(),
    periodTimeZone: PACIFIC_TIME_ZONE,
    staleAfterSeconds: STALE_AFTER_MS / 1000,
    storage: storage
      ? createAvailableMetric(storage.value, FIRESTORE_FREE_LIMITS.storageBytes, storage.latestPointAt, measuredAt, "usedBytes")
      : createUnavailableMetric(FIRESTORE_FREE_LIMITS.storageBytes, "usedBytes"),
    reads: reads
      ? createAvailableMetric(reads.value, FIRESTORE_FREE_LIMITS.readsPerDay, reads.latestPointAt, measuredAt, "usedToday")
      : createUnavailableMetric(FIRESTORE_FREE_LIMITS.readsPerDay, "usedToday"),
    writes: writes
      ? createAvailableMetric(writes.value, FIRESTORE_FREE_LIMITS.writesPerDay, writes.latestPointAt, measuredAt, "usedToday")
      : createUnavailableMetric(FIRESTORE_FREE_LIMITS.writesPerDay, "usedToday"),
  };

  usageCache = {
    projectId,
    createdAt: measuredAt.getTime(),
    value: response,
  };
  return response;
}

function resetUsageCache() {
  usageCache = null;
}

module.exports = {
  FIRESTORE_FREE_LIMITS,
  FIRESTORE_METRICS,
  PACIFIC_TIME_ZONE,
  createAvailableMetric,
  createUnavailableMetric,
  getFirestoreUsage,
  getPacificDayStart,
  getUsageStatus,
  resetUsageCache,
  sumDeltaTimeSeries,
  sumLatestGaugeTimeSeries,
  timestampToMilliseconds,
};
