import assert from "node:assert/strict";
import test from "node:test";
import {
  PENDING_AUTH_MAX_AGE_MS,
  createPendingAuth,
  isPendingAuthStale,
  matchPendingAuth,
  shouldActivateViewAfterAuth,
} from "../auth-flow";

test("createPendingAuth records the requested flow and return target", () => {
  const pendingAuth = createPendingAuth({
    code: "handoff-123",
    flow: "zotero-connect",
    returnTarget: "stay-settings",
    now: new Date("2026-04-11T12:00:00.000Z"),
  });

  assert.deepEqual(pendingAuth, {
    code: "handoff-123",
    flow: "zotero-connect",
    returnTarget: "stay-settings",
    createdAt: "2026-04-11T12:00:00.000Z",
  });
});

test("matchPendingAuth distinguishes missing, mismatched, stale, and valid callbacks", () => {
  const pendingAuth = createPendingAuth({
    code: "handoff-123",
    flow: "stratum-sign-in",
    returnTarget: "stay-settings",
    now: new Date("2026-04-11T12:00:00.000Z"),
  });
  const freshNow =
    Date.parse(pendingAuth.createdAt) + PENDING_AUTH_MAX_AGE_MS - 1;
  const staleNow =
    Date.parse(pendingAuth.createdAt) + PENDING_AUTH_MAX_AGE_MS + 1;

  assert.equal(
    matchPendingAuth({
      handoff: null,
      pendingAuth,
    }),
    "missing_handoff",
  );
  assert.equal(
    matchPendingAuth({
      handoff: "handoff-123",
      pendingAuth: null,
    }),
    "missing_pending_auth",
  );
  assert.equal(
    matchPendingAuth({
      handoff: "wrong",
      pendingAuth,
    }),
    "mismatch",
  );
  assert.equal(
    matchPendingAuth({
      handoff: "handoff-123",
      pendingAuth,
      now: freshNow,
    }),
    "matched",
  );
  assert.equal(
    matchPendingAuth({
      handoff: "handoff-123",
      pendingAuth,
      now: staleNow,
    }),
    "stale",
  );
});

test("shouldActivateViewAfterAuth only opens the panel for explicit panel targets", () => {
  assert.equal(
    shouldActivateViewAfterAuth(
      createPendingAuth({
        code: "handoff-1",
        flow: "stratum-sign-in",
        returnTarget: "stay-settings",
      }),
    ),
    false,
  );
  assert.equal(
    shouldActivateViewAfterAuth(
      createPendingAuth({
        code: "handoff-2",
        flow: "stratum-sign-in",
        returnTarget: "open-panel-search",
      }),
    ),
    true,
  );
});

test("isPendingAuthStale only flags expired or malformed pending auth state", () => {
  const pendingAuth = createPendingAuth({
    code: "handoff-123",
    flow: "stratum-sign-in",
    returnTarget: "stay-settings",
    now: new Date("2026-04-11T12:00:00.000Z"),
  });
  const freshNow =
    Date.parse(pendingAuth.createdAt) + PENDING_AUTH_MAX_AGE_MS - 1;
  const staleNow =
    Date.parse(pendingAuth.createdAt) + PENDING_AUTH_MAX_AGE_MS + 1;

  assert.equal(isPendingAuthStale({ pendingAuth: null }), false);
  assert.equal(isPendingAuthStale({ pendingAuth, now: freshNow }), false);
  assert.equal(isPendingAuthStale({ pendingAuth, now: staleNow }), true);
  assert.equal(
    isPendingAuthStale({
      pendingAuth: {
        ...pendingAuth,
        createdAt: "not-a-date",
      },
    }),
    true,
  );
});
