import assert from "node:assert/strict";
import test from "node:test";
import type { BackendClient } from "../backend-client";
import { createPendingAuth } from "../auth-flow";
import type { handleAuthProtocol } from "../plugin-auth";
import type StratumPlugin from "../plugin";
import { loadRuntime } from "./runtime-harness";

function setup() {
  let resolve!: (value: unknown) => void;
  let reject!: (error: Error) => void;
  const pending = new Promise((done, fail) => {
    resolve = done;
    reject = fail;
  });
  const notices: string[] = [];
  const obsidian = {
    requestUrl: () => pending,
    Notice: class {
      constructor(message: string) {
        notices.push(message);
      }
    },
    Platform: { isDesktopApp: false },
  };
  const { BackendClient: Client } = loadRuntime<{
    BackendClient: typeof BackendClient;
  }>("backend-client.ts", obsidian);
  const { handleAuthProtocol: handle } = loadRuntime<{
    handleAuthProtocol: typeof handleAuthProtocol;
  }>("plugin-auth.ts", obsidian);
  const oldSession = {
    accessToken: "old",
    refreshToken: "old-refresh",
    expiresAt: null,
  };
  const users: unknown[] = [];
  const client = new Client({
    initialSession: oldSession,
    onSessionChange: () => Promise.resolve(),
    onUserChange: (user) => {
      users.push(user);
      return Promise.resolve();
    },
  });
  const plugin = {
    isUnloaded: false,
    settings: {
      pendingAuth: createPendingAuth({
        code: "first-flow",
        flow: "stratum-sign-in",
        returnTarget: "stay-settings",
      }),
    },
    backend: client,
  } as unknown as StratumPlugin;
  const run = () =>
    handle(plugin, {
      action: "stratum-auth",
      handoff: "first-flow",
      access_token: "new",
      refresh_token: "new-refresh",
    });
  return { plugin, run, client, users, notices, resolve, reject, oldSession };
}

test("starting a new auth flow rejects a delayed callback without clearing the new handoff", async () => {
  const f = setup();
  const callback = f.run();
  const newer = createPendingAuth({
    code: "second-flow",
    flow: "stratum-sign-in",
    returnTarget: "stay-settings",
  });
  f.plugin.settings.pendingAuth = newer;
  f.resolve({
    status: 200,
    json: { id: "account-two", email: "new@example.test" },
  });
  await callback;
  assert.equal(f.client.getSession(), f.oldSession);
  assert.equal(f.plugin.settings.pendingAuth, newer);
  assert.deepEqual(f.users, []);
  assert.deepEqual(f.notices, []);
});

test("a sign-in error after unload does not display a stale notice", async () => {
  const f = setup();
  const callback = f.run();
  f.plugin.isUnloaded = true;
  f.reject(new Error("Offline"));
  await callback;
  assert.equal(f.client.getSession(), f.oldSession);
  assert.deepEqual(f.notices, []);
});

test("a failed verification keeps the pending handoff and displays a retry notice", async () => {
  const f = setup();
  const before = f.plugin.settings.pendingAuth;
  const callback = f.run();
  f.resolve({ status: 503, json: {} });
  await callback;
  assert.equal(f.client.getSession(), f.oldSession);
  assert.equal(f.plugin.settings.pendingAuth, before);
  assert.equal(f.notices.length, 1);
  assert.match(f.notices[0], /Try signing in again/);
});
