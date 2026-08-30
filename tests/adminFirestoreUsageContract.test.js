const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const adminHtml = fs.readFileSync(path.join(root, "src/pages/admin/admin.html"), "utf8");
const adminJs = fs.readFileSync(path.join(root, "src/pages/admin/admin.js"), "utf8");
const adminCss = fs.readFileSync(path.join(root, "src/shared/styles/admin.css"), "utf8");
const adminService = fs.readFileSync(path.join(root, "src/shared/services/AdminService.js"), "utf8");

[
  "data-target=\"usage\"",
  "id=\"pane-usage\"",
  "id=\"firestoreUsageStorageValue\"",
  "id=\"firestoreUsageReadsValue\"",
  "id=\"firestoreUsageWritesValue\"",
  "id=\"refreshFirestoreUsageBtn\"",
  "id=\"firestoreUsageError\"",
].forEach((requiredMarkup) => {
  assert.ok(adminHtml.includes(requiredMarkup), `Missing admin usage markup: ${requiredMarkup}`);
});

[
  "loadFirestoreUsage",
  "renderFirestoreUsage",
  "renderFirestoreUsageMetric",
  "formatFirestoreBytes",
  "refreshFirestoreUsageBtn",
].forEach((requiredMethod) => {
  assert.ok(adminJs.includes(requiredMethod), `Missing admin usage behavior: ${requiredMethod}`);
});

[
  "firestore-usage-grid",
  "firestore-usage-card",
  "usage-status--warning",
  "prefers-reduced-motion",
].forEach((requiredSelector) => {
  assert.ok(adminCss.includes(requiredSelector), `Missing admin usage style: ${requiredSelector}`);
});

assert.ok(adminService.includes("getFirestoreUsage"), "AdminService usage method is missing");
assert.ok(adminService.includes("firestoreUsage"), "AdminService usage endpoint is missing");
assert.ok(adminJs.includes("renderFirestoreUsageError()"), "Usage errors need a dedicated safe state");
assert.ok(adminJs.includes("Не удалось получить статистику Firestore. Повторите попытку."), "Usage errors need localized safe copy");
assert.ok(!adminJs.includes("error?.message || 'неизвестная ошибка'"), "Usage errors must not expose raw provider messages");

console.log("adminFirestoreUsageContract.test.js: all tests passed");
