import assert from "node:assert/strict";
import test from "node:test";
import { verifyPublishingTools } from "./require-publishing-tools.mjs";
test("CI preflight rejects missing tools instead of allowing conversion tests to skip", () => {
  const env = { STRATUM_TEST_CHROME: "/synthetic/chrome" };
  for (const missing of [
    "pandoc",
    "tectonic",
    "pdftotext",
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
            return { status: 0, stdout: "Synthetic installed dependency" };
          },
          "linux",
        ),
      /Required CI publishing dependency/,
    );
  }
  assert.throws(
    () =>
      verifyPublishingTools(
        {},
        () => ({ status: 0, stdout: "Available" }),
        "linux",
      ),
    /STRATUM_TEST_CHROME/,
  );
  assert.throws(
    () =>
      verifyPublishingTools(
        env,
        (executable) => ({
          status: 0,
          stdout: executable === "fc-list" ? "" : "Available",
          stderr: "Synthetic warning must not count as an installed font",
        }),
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
      return { status: 0, stdout: "Synthetic version\n" };
    },
    "linux",
  );
  assert.equal(Object.keys(versions).length, 5);
  assert(
    calls.some(
      ([executable, argument]) =>
        executable === "pdftotext" && argument === "-v",
    ),
  );
  assert(calls.some(([executable]) => executable === "/synthetic/pandoc"));
});

test("tool reports retain versions written to stderr and reject unsuccessful probes", () => {
  const env = { STRATUM_TEST_CHROME: "/synthetic/chrome" };
  const versions = verifyPublishingTools(
    env,
    () => ({
      status: 0,
      stdout: "",
      stderr: "Synthetic version\nCopyright notice",
    }),
    "darwin",
  );
  assert.equal(versions.pdftotext, "Synthetic version");
  for (const result of [
    { status: 2 },
    { status: null, error: new Error("Synthetic spawn failure") },
  ])
    assert.throws(
      () => verifyPublishingTools(env, () => result, "linux"),
      /Required CI publishing dependency pandoc/,
    );
});
