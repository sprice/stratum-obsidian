import assert from "node:assert/strict";
import test from "node:test";
import { verifyPublishingTools } from "./require-publishing-tools.mjs";
test("CI preflight rejects missing tools instead of allowing conversion tests to skip", () => {
  const env = { STRATUM_TEST_CHROME: "/synthetic/chrome" };
  for (const missing of [
    "pandoc",
    "tectonic",
    "pdftotext",
    "python3",
    "/synthetic/chrome",
    "fc-list",
  ]) {
    assert.throws(
      () =>
        verifyPublishingTools(
          env,
          (executable) => {
            if (executable === missing)
              throw new Error("Synthetic missing executable");
            return "Synthetic installed dependency";
          },
          "linux",
        ),
      /Required CI publishing dependency/,
    );
  }
  assert.throws(
    () => verifyPublishingTools({}, () => "Available", "linux"),
    /STRATUM_TEST_CHROME/,
  );
  assert.throws(
    () =>
      verifyPublishingTools(
        env,
        (executable) => (executable === "fc-list" ? "" : "Available"),
        "linux",
      ),
    /dependency fonts/,
  );
});
test("CI preflight uses explicit paths and the correct Poppler version argument", () => {
  const calls = [];
  const versions = verifyPublishingTools(
    {
      STRATUM_TEST_CHROME: "/synthetic/chrome",
      STRATUM_TEST_PANDOC: "/synthetic/pandoc",
    },
    (executable, args) => {
      calls.push([executable, ...args]);
      return "Synthetic version\n";
    },
    "linux",
  );
  assert.equal(Object.keys(versions).length, 6);
  assert(
    calls.some(
      ([executable, argument]) =>
        executable === "pdftotext" && argument === "-v",
    ),
  );
  assert(calls.some(([executable]) => executable === "/synthetic/pandoc"));
});
