# Random marathon hardening reflection

The original client-only counter was insufficient because concurrent users could
write separate item documents without a server-enforced count. The existing
Firebase Functions surface provided the smallest compatible owner: the client
now requests authenticated mutations, while Firestore remains the read and
subscription surface. Transactional reads were kept inside the transaction after
review found that pre-fetched item queries could cross a round boundary.

The personal `randomPool` remains device-local. Direct Firestore mutations for
the marathon are denied, and the deployed endpoint is the canonical mutation
owner. Focused tests, build, rules compilation, deployment, and unauthenticated
endpoint checks passed. Authenticated browser behavior, real multi-user
contention, and legacy-data cleanup remain outside the evidence available here.
