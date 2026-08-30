const assert = require("assert");
const {
  assertSecretVersionReference,
  getFirebaseConfigProjectId,
  getProjectId,
  normalizeSecretVersionReference,
} = require("../functions/providerKeyVault");

const originalFirebaseConfig = process.env.FIREBASE_CONFIG;
const originalGoogleCloudProject = process.env.GOOGLE_CLOUD_PROJECT;
const originalGcloudProject = process.env.GCLOUD_PROJECT;

try {
  process.env.FIREBASE_CONFIG = JSON.stringify({ projectId: "movielistdb-13208" });
  process.env.GOOGLE_CLOUD_PROJECT = "532518163829";
  process.env.GCLOUD_PROJECT = "532518163829";

  assert.equal(getFirebaseConfigProjectId(), "movielistdb-13208");
  assert.equal(getProjectId(), "movielistdb-13208");
  assert.equal(getProjectId("explicit-project"), "explicit-project");
  const numericReference = "projects/532518163829/secrets/provider-key-kinopoisk-demo/versions/1";
  assert.doesNotThrow(() => assertSecretVersionReference(numericReference, "movielistdb-13208"));
  assert.equal(
    normalizeSecretVersionReference(numericReference, "movielistdb-13208"),
    "projects/movielistdb-13208/secrets/provider-key-kinopoisk-demo/versions/1"
  );
  assert.throws(
    () => assertSecretVersionReference("projects/other-project/secrets/provider-key-kinopoisk-demo/versions/1", "movielistdb-13208"),
    /Secret version reference is invalid/
  );
  console.log("providerKeyVault.test.cjs: all tests passed");
} finally {
  if (originalFirebaseConfig === undefined) delete process.env.FIREBASE_CONFIG;
  else process.env.FIREBASE_CONFIG = originalFirebaseConfig;
  if (originalGoogleCloudProject === undefined) delete process.env.GOOGLE_CLOUD_PROJECT;
  else process.env.GOOGLE_CLOUD_PROJECT = originalGoogleCloudProject;
  if (originalGcloudProject === undefined) delete process.env.GCLOUD_PROJECT;
  else process.env.GCLOUD_PROJECT = originalGcloudProject;
}
