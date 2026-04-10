import assert from "node:assert/strict";
import test from "node:test";
import { hasAuthenticatedUserRequiredError } from "../backend-auth";

test("hasAuthenticatedUserRequiredError matches the backend auth payload", () => {
  assert.equal(
    hasAuthenticatedUserRequiredError({
      error: "Authenticated user required",
    }),
    true,
  );
  assert.equal(
    hasAuthenticatedUserRequiredError({
      error: "authenticated user required",
    }),
    true,
  );
  assert.equal(
    hasAuthenticatedUserRequiredError({
      error: "Zotero account is not connected",
    }),
    false,
  );
  assert.equal(hasAuthenticatedUserRequiredError(null), false);
});
