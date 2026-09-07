#!/usr/bin/env node

/**
 * Read-only rating projection audit with an explicit derived-state repair mode.
 *
 * Default: scan and print violations.
 * Apply: node scripts/audit-rating-integrity.cjs --apply --movie-ids 18808,938643
 * Credentials: GOOGLE_APPLICATION_CREDENTIALS or serviceAccountKey.json.
 * The script never deletes ratings or movie documents.
 */

const fs = require('node:fs');
const path = require('node:path');
const process = require('node:process');
const { createRequire } = require('node:module');
const functionsRequire = createRequire(path.join(__dirname, '..', 'functions', 'package.json'));
const { initializeApp, getApps, cert } = functionsRequire('firebase-admin/app');
const { getFirestore } = functionsRequire('firebase-admin/firestore');
const { scanRatingProjectionIntegrity } = require('../functions/ratingIntegrityService');

function parseArgs(argv) {
  const args = new Set(argv);
  const movieIdsIndex = argv.indexOf('--movie-ids');
  const movieIds = movieIdsIndex >= 0 ? argv[movieIdsIndex + 1] : '';
  return {
    apply: args.has('--apply'),
    movieIds: movieIds
      ? movieIds.split(',').map((value) => value.trim()).filter(Boolean)
      : null,
  };
}

function initializeAdmin() {
  if (getApps().length > 0) return;
  const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS
    || path.join(__dirname, '..', 'serviceAccountKey.json');
  if (!fs.existsSync(credentialsPath)) {
    throw new Error(
      `Firebase credentials not found at ${credentialsPath}. `
      + 'Set GOOGLE_APPLICATION_CREDENTIALS before running the audit.'
    );
  }
  const serviceAccount = require(credentialsPath);
  initializeApp({ credential: cert(serviceAccount) });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  initializeAdmin();
  const result = await scanRatingProjectionIntegrity({
    db: getFirestore(),
    apply: options.apply,
    movieIds: options.movieIds,
  });

  console.log(JSON.stringify({
    dryRun: !options.apply,
    scannedRatings: result.scannedRatings,
    scannedMovieIds: result.scannedMovieIds,
    violationCount: result.violationCount,
    repairedCount: result.repairedCount,
    violations: result.violations.map(({ movieId, differences, expected, current }) => ({
      movieId,
      differences,
      name: current?.name || current?.title || null,
      expected,
      current: current && {
        kinopoiskId: current.kinopoiskId,
        ratingsCount: current.ratingsCount,
        ratingsSum: current.ratingsSum,
        avgRating: current.avgRating,
        hasCommunityRating: current.hasCommunityRating,
        hasRatings: current.hasRatings,
        lastRatingUpdatedAt: current.lastRatingUpdatedAt,
      },
    })),
  }, null, 2));
}

main().catch((error) => {
  console.error(`[rating-integrity] ${error.message}`);
  process.exitCode = 1;
});
