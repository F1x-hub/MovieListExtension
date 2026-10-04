# Watch-room capacity and reconnect reflection

## Result

The requested staging-room behavior is implemented without moving presence into
Firestore or changing unrelated room modes. The original two-person rejection
path now admits 10 total participants, while RTDB reconnect preserves the room
session and re-arms ephemeral presence cleanup.

## Directional judgment

The canonical ownership boundary held: Firestore remains durable membership and
capacity, while RTDB remains live presence and transport. A root `value` presence
listener was replaced with child-level updates and per-connection records to
avoid one tab removing another tab's status. New clients now use `presenceV2`,
legacy presence remains read-compatible, and the create transaction records a
replayable result for transport retries.

## Remaining follow-up

Perform a real 10-client browser acceptance test with a forced network
interruption before calling the feature production-ready. Staging Functions,
RTDB Rules, and Firestore Rules are already deployed.
