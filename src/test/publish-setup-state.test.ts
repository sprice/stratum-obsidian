import assert from "node:assert/strict";
import test from "node:test";
import {
  publishingSetupAction,
  publishingToolState,
} from "../publish-setup-state";
import type { PublishReadiness } from "../publish-desktop";

const detected = { path: "/synthetic/tool", version: "1.0" };
const readiness: PublishReadiness = {
  pandoc: detected,
  tectonic: detected,
  word: true,
  pdf: false,
};

test("installed Tectonic awaiting verification never asks the user to install it", () => {
  const state = publishingToolState(detected, false, undefined, false);
  assert.equal(state.label, "Detected");
  assert.equal(state.missing, false);
  assert.equal(publishingSetupAction(readiness, false), "Enable PDF");
});

test("missing, blocked, and failed conversion states have distinct recovery paths", () => {
  const missing = publishingToolState(
    { path: "", version: "" },
    false,
    undefined,
    false,
  );
  assert.equal(missing.missing, true);
  const blocked = publishingToolState(
    {
      path: "",
      version: "",
      foundPath: "/synthetic/tool",
      error: "Permission denied",
    },
    false,
    undefined,
    false,
  );
  assert.equal(blocked.missing, false);
  assert.equal(blocked.label, "Couldn't run");
  const failed = publishingToolState(
    detected,
    false,
    "Network unavailable",
    false,
  );
  assert.equal(failed.missing, false);
  assert.equal(failed.detail, "Network unavailable");
  assert.equal(
    publishingSetupAction({ ...readiness, pdfError: failed.detail }, false),
    "Retry check",
  );
});

test("checking and completion offer one clear primary action", () => {
  assert.equal(
    publishingToolState(undefined, false, undefined, true).label,
    "Looking…",
  );
  assert.equal(publishingSetupAction(readiness, true), "Checking…");
  assert.equal(
    publishingSetupAction({ ...readiness, pdf: true }, false),
    "Done",
  );
  assert.equal(
    publishingToolState(detected, true, undefined, true).label,
    "Ready",
  );
});
