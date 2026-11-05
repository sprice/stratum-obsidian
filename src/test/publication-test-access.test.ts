import assert from "node:assert/strict";
import test from "node:test";
import { loadRuntime } from "./runtime-harness";
import { registryRetryDelay } from "../publication-registry-retry";

test("local testing credential requires an explicitly enabled build and matching origin", () => {
  const module = (globals = {}) =>
    loadRuntime<typeof import("../publication-test-access")>(
      "publication-test-access.ts",
      { Platform: { isDesktop: true } },
      globals,
    );
  const config = { origin: "https://example.org", secret: "a".repeat(64) };
  let reads = 0;
  const require = () => ({
    readFileSync: () => {
      reads++;
      return JSON.stringify(config);
    },
  });
  assert.equal(
    JSON.stringify(module().templateTestHeaders(config.origin, require)),
    "{}",
  );
  assert.equal(reads, 0);
  const enabled = module({
    __STRATUM_TEMPLATE_TEST_CONFIG_PATH__: "/synthetic/private.json",
  });
  assert.equal(
    enabled.templateTestHeaders(config.origin, require)[
      "X-Stratum-Template-Test-Secret"
    ],
    config.secret,
  );
  assert.equal(
    JSON.stringify(enabled.templateTestHeaders("https://other.org", require)),
    "{}",
  );
  assert.equal(
    JSON.stringify(
      enabled.templateTestHeaders(config.origin, () => {
        throw new Error("missing");
      }),
    ),
    "{}",
  );
  config.secret = "invalid";
  assert.equal(
    JSON.stringify(enabled.templateTestHeaders(config.origin, require)),
    "{}",
  );
});
test("retries are bounded, support dates, and never retry redirects or shorten long delays", () => {
  assert.equal(registryRetryDelay(429, "60", 0), 60000);
  assert.equal(registryRetryDelay(503, undefined, 2), 4000);
  assert.equal(
    registryRetryDelay(
      503,
      "Thu, 05 Nov 2026 12:00:05 GMT",
      0,
      Date.parse("2026-11-05T12:00:00Z"),
    ),
    5000,
  );
  for (const [status, header, attempt] of [
    [302, "1", 0],
    [429, "61", 0],
    [503, "bad", 0],
    [503, "1", 3],
  ] as const)
    assert.equal(registryRetryDelay(status, header, attempt), null);
});

test("mobile ignores the development file without loading desktop APIs", () => {
  const mobile = loadRuntime<typeof import("../publication-test-access")>(
    "publication-test-access.ts",
    { Platform: { isDesktop: false } },
    { __STRATUM_TEMPLATE_TEST_CONFIG_PATH__: "/synthetic/private.json" },
  );
  assert.equal(
    JSON.stringify(
      mobile.templateTestHeaders("https://example.org", () => {
        assert.fail("Mobile must not load Node filesystem APIs");
      }),
    ),
    "{}",
  );
});
