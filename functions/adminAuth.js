function getBearerToken(req) {
  const authorization = typeof req?.headers?.authorization === "string"
    ? req.headers.authorization.trim()
    : "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}

function setAdminCors(req, res) {
  const origin = req?.headers?.origin;
  const isAllowedOrigin = !origin || origin.startsWith("chrome-extension://") ||
    origin.startsWith("http://localhost") || origin.startsWith("http://127.0.0.1");

  if (!isAllowedOrigin) return false;

  if (origin) res.set("Access-Control-Allow-Origin", origin);
  res.set("Vary", "Origin");
  res.set("Access-Control-Allow-Methods", "GET, OPTIONS, POST");
  res.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.set("Access-Control-Max-Age", "3600");
  return true;
}

function createAdminAuthVerifier({ auth, db }) {
  if (!auth || typeof auth.verifyIdToken !== "function") {
    throw new Error("Firebase Auth verifier is not configured");
  }
  if (!db || typeof db.collection !== "function") {
    throw new Error("Firestore admin client is not configured");
  }

  return async function verifyAdminRequest(req) {
    const idToken = getBearerToken(req);
    if (!idToken) {
      const error = new Error("Authentication is required");
      error.statusCode = 401;
      throw error;
    }

    let decodedToken;
    try {
      decodedToken = await auth.verifyIdToken(idToken);
    } catch (error) {
      error.statusCode = 401;
      throw error;
    }

    const profileSnapshot = await db.collection("users").doc(decodedToken.uid).get();
    if (!profileSnapshot.exists || profileSnapshot.data()?.isAdmin !== true) {
      const error = new Error("Admin access is required");
      error.statusCode = 403;
      throw error;
    }

    return decodedToken;
  };
}

module.exports = {
  createAdminAuthVerifier,
  getBearerToken,
  setAdminCors,
};
