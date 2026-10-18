import assert from "node:assert/strict";
import test from "node:test";
import type * as LiveSync from "../plugin-local-live-sync";
import type { LocalZoteroHeartbeatCheckpoint } from "../settings-data";
import { loadRuntime } from "./runtime-harness";

class FakeFile {
  path = "Papers/Synthetic.md";
}
class ApiError extends Error {
  constructor(
    message: string,
    public status: number | null = null,
  ) {
    super(message);
  }
}
class Unavailable extends ApiError {}

function fixture() {
  let timer: (() => void) | undefined;
  let delay = 0;
  let version = 1;
  let serverId = "synthetic-server";
  let failure: Error | null = null;
  let refreshFails = false;
  let skippedRefreshes = 0;
  let discoveries = 0;
  let refreshes = 0;
  let focus: (() => void) | undefined;
  let hold: Promise<void> | undefined;
  let refreshHold: Promise<void> | undefined;
  let requests = 0;
  let reads = 0;
  let saves = 0;
  let saveFails = false;
  const busyStates: boolean[] = [];
  const file = new FakeFile();
  const state = { lastError: null as string | null };
  const library = {
    type: "user",
    id: "1",
    identity: "user:1",
    name: "Personal",
  };
  const plugin = {
    isUnloaded: false,
    settings: {
      accountId: "account-a",
      bulkSyncEnabled: true,
      zoteroLocalApiPort: 23119,
      localZoteroHeartbeats: {} as Record<
        string,
        LocalZoteroHeartbeatCheckpoint
      >,
      itemFileMap: {
        "user/1/ABCD1234": {
          filePath: file.path,
          zoteroItemKey: "ABCD1234",
          zoteroVersion: 0,
        },
        "group/2/OTHER": {
          filePath: "Papers/Other.md",
          zoteroItemKey: "OTHER",
          zoteroVersion: 0,
        },
      },
    },
    backend: { hasSession: () => true },
    zoteroConnection: { connected: true },
    localSyncLibraries: [library],
    localZoteroUserId: "1",
    localLiveSyncDebounceTimer: null as number | null,
    localLiveSyncRunPromise: null as Promise<void> | null,
    localLiveSyncApplyingChanges: false,
    localLiveSyncError: null as string | null,
    isBulkLibrarySyncRunning: () => false,
    saveSettings: () => {
      saves++;
      return saveFails
        ? Promise.reject(new Error("Save failed"))
        : Promise.resolve();
    },
    refreshViews: () => {},
    refreshAutoSyncUi: () => {
      busyStates.push(plugin.localLiveSyncApplyingChanges);
    },
    registerDomEvent: (_window: unknown, _event: string, cb: () => void) => {
      focus = cb;
    },
    app: {
      vault: {
        getAbstractFileByPath: (path: string) => {
          reads++;
          assert.equal(path, file.path);
          return file;
        },
      },
    },
  };
  const runtime = loadRuntime<typeof LiveSync>(
    "plugin-local-live-sync.ts",
    { Platform: { isDesktopApp: true }, TFile: FakeFile },
    {
      Error,
      window: {
        setTimeout: (cb: () => void, ms: number) => {
          timer = cb;
          delay = ms;
          return 1;
        },
        clearTimeout: () => {
          timer = undefined;
        },
      },
    },
    "node",
    {
      "./zotero-local": {
        LocalZoteroApiError: ApiError,
        LocalZoteroUnavailableError: Unavailable,
        loadLocalZoteroHeartbeat: async () => {
          requests++;
          await hold;
          if (failure) throw failure;
          return { serverId, libraryVersion: version };
        },
      },
      "./plugin-local-sync": {
        refreshLocalSyncLibraries: () => {
          discoveries++;
          plugin.localSyncLibraries = [library];
          return Promise.resolve([library]);
        },
      },
      "./plugin-libraries": { getLibraryAutoSyncState: () => state },
      "./plugin-note-refresh": {
        refreshOpenedLiteratureNote: (
          _plugin: unknown,
          _file: unknown,
          options: { background: boolean; sourceMissing: boolean },
        ) => {
          assert.equal(options.background, true);
          assert.equal(options.sourceMissing, true);
          if (skippedRefreshes > 0) {
            skippedRefreshes--;
            return null;
          }
          return (async () => {
            refreshes++;
            await refreshHold;
            state.lastError = refreshFails ? "Failed" : null;
          })();
        },
      },
    },
  );
  return {
    plugin,
    runtime,
    busyStates,
    setVersion: (value: number) => {
      version = value;
    },
    setServer: (value: string) => {
      serverId = value;
    },
    setFailure: (value: Error | null) => {
      failure = value;
    },
    failSave: (value: boolean) => {
      saveFails = value;
    },
    skipRefreshes: (value: number) => {
      skippedRefreshes = value;
    },
    get discoveries() {
      return discoveries;
    },
    failRefresh: (value: boolean) => {
      refreshFails = value;
    },
    hold: (value: Promise<void>) => {
      hold = value;
    },
    holdRefresh: (value: Promise<void>) => {
      refreshHold = value;
    },
    get refreshes() {
      return refreshes;
    },
    get requests() {
      return requests;
    },
    get reads() {
      return reads;
    },
    get saves() {
      return saves;
    },
    get delay() {
      return delay;
    },
    get timer() {
      return timer;
    },
    focus: () => focus?.(),
    start: () => runtime.reconcileLocalLiveSync(plugin as never),
    tick: async () => {
      assert.ok(timer);
      const cb = timer;
      timer = undefined;
      cb();
      await plugin.localLiveSyncRunPromise;
    },
  };
}

test("startup and unchanged heartbeats never inspect notes or display syncing", async () => {
  const f = fixture();
  f.start();
  await f.tick();
  await f.tick();
  f.focus();
  await f.tick();
  assert.equal(f.refreshes, 0);
  assert.equal(f.reads, 0);
  assert.deepEqual(f.busyStates, []);
  assert.equal(f.saves, 1);
  assert.equal(f.delay, 30_000);
});

test("changed counters refresh only the changed library, once, including source deletions", async () => {
  const f = fixture();
  f.start();
  await f.tick();
  f.setVersion(2);
  await f.tick();
  assert.equal(f.refreshes, 1);
  assert.equal(f.reads, 1);
  assert.deepEqual(f.busyStates, [true, false]);
  assert.equal(
    f.plugin.settings.localZoteroHeartbeats["user:1"].libraryVersion,
    2,
  );
  await f.tick();
  assert.equal(f.refreshes, 1);
});

test("persisted checkpoints skip reload work but catch changes while Obsidian was closed", async () => {
  const first = fixture();
  first.start();
  await first.tick();
  const next = fixture();
  next.plugin.settings.localZoteroHeartbeats = structuredClone(
    first.plugin.settings.localZoteroHeartbeats,
  );
  next.start();
  await next.tick();
  assert.equal(next.reads, 0);
  next.setVersion(2);
  await next.tick();
  assert.equal(next.refreshes, 1);
});

test("failed refresh keeps the library checkpoint and retries after bulk sync yields", async () => {
  const f = fixture();
  f.start();
  await f.tick();
  f.setVersion(2);
  f.failRefresh(true);
  await f.tick();
  assert.equal(
    f.plugin.settings.localZoteroHeartbeats["user:1"].libraryVersion,
    1,
  );
  assert.equal(f.delay, 60_000);
  f.plugin.isBulkLibrarySyncRunning = () => true;
  await f.tick();
  assert.equal(f.refreshes, 1);
  f.plugin.isBulkLibrarySyncRunning = () => false;
  f.failRefresh(false);
  f.runtime.notifyLocalLiveSyncAfterBulkSync(f.plugin as never);
  await f.tick();
  assert.equal(f.refreshes, 2);
  assert.equal(
    f.plugin.settings.localZoteroHeartbeats["user:1"].libraryVersion,
    2,
  );
});

test("closing Zotero retains checkpoints and changes are caught after reconnecting", async () => {
  const f = fixture();
  f.start();
  await f.tick();
  f.setFailure(new Unavailable("Closed"));
  await f.tick();
  assert.equal(f.delay, 60_000);
  assert.match(f.plugin.localLiveSyncError!, /Saved notes remain available/);
  f.setVersion(2);
  f.setFailure(null);
  f.focus();
  await f.tick();
  assert.equal(f.refreshes, 1);
  assert.equal(f.plugin.localLiveSyncError, null);
});

test("polls never overlap and unload prevents note work and rescheduling", async () => {
  const f = fixture();
  let release!: () => void;
  f.hold(
    new Promise<void>((resolve) => {
      release = resolve;
    }),
  );
  f.start();
  const pending = f.tick();
  f.focus();
  const duplicate = f.tick();
  assert.equal(f.requests, 1);
  f.plugin.isUnloaded = true;
  release();
  await Promise.all([pending, duplicate]);
  assert.equal(f.reads, 0);
  assert.equal(f.saves, 0);
  assert.equal(f.timer, undefined);
});

test("API failures preserve checkpoints and disabled APIs show actionable status", async () => {
  const f = fixture();
  f.start();
  await f.tick();
  f.setFailure(new ApiError("Disabled", 403));
  await f.tick();
  assert.match(f.plugin.localLiveSyncError!, /Enable Zotero/);
  f.setFailure(new ApiError("Not found", 404));
  await f.tick();
  assert.match(f.plugin.localLiveSyncError!, /Not found/);
  assert.equal(
    f.plugin.settings.localZoteroHeartbeats["user:1"].libraryVersion,
    1,
  );
});

test("opening Zotero after an offline start establishes a quiet baseline", async () => {
  const f = fixture();
  f.plugin.localSyncLibraries = [];
  f.setFailure(new Unavailable("Closed"));
  f.start();
  await f.tick();
  f.setFailure(null);
  await f.tick();
  assert.equal(f.plugin.localSyncLibraries.length, 1);
  assert.equal(f.refreshes, 0);
  assert.equal(f.reads, 0);
});

for (const change of ["account", "port", "server", "rollback"] as const) {
  test(`${change} changes establish a new baseline without comparing unrelated counters`, async () => {
    const f = fixture();
    f.start();
    await f.tick();
    f.setVersion(2);
    if (change === "account") f.plugin.settings.accountId = "account-b";
    if (change === "port") f.plugin.settings.zoteroLocalApiPort = 23120;
    if (change === "server") f.setServer("another-server");
    if (change === "rollback") f.setVersion(0);
    await f.tick();
    assert.equal(f.refreshes, 0);
    assert.equal(f.reads, 0);
  });
}

for (const change of ["account", "port", "bulk"] as const) {
  test(`${change} changes invalidate an in-flight heartbeat`, async () => {
    const f = fixture();
    f.start();
    await f.tick();
    f.setVersion(2);
    let release!: () => void;
    f.hold(
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );
    const pending = f.tick();
    if (change === "account") f.plugin.settings.accountId = "account-b";
    if (change === "port") f.plugin.settings.zoteroLocalApiPort = 23120;
    if (change === "bulk") f.plugin.isBulkLibrarySyncRunning = () => true;
    release();
    await pending;
    assert.equal(f.refreshes, 0);
    assert.equal(
      f.plugin.settings.localZoteroHeartbeats["user:1"].libraryVersion,
      1,
    );
  });
}

test("a change during refresh remains visible to the next heartbeat", async () => {
  const f = fixture();
  f.start();
  await f.tick();
  f.setVersion(2);
  let release!: () => void;
  f.holdRefresh(
    new Promise<void>((resolve) => {
      release = resolve;
    }),
  );
  const pending = f.tick();
  while (f.refreshes === 0) await Promise.resolve();
  f.setVersion(3);
  release();
  await pending;
  assert.equal(
    f.plugin.settings.localZoteroHeartbeats["user:1"].libraryVersion,
    2,
  );
  await f.tick();
  assert.equal(f.refreshes, 2);
});

test("failed checkpoint persistence is retried without silently adopting the counter", async () => {
  const f = fixture();
  f.failSave(true);
  f.start();
  await f.tick();
  assert.deepEqual(f.plugin.settings.localZoteroHeartbeats, {});
  f.failSave(false);
  await f.tick();
  f.setVersion(2);
  f.failSave(true);
  await f.tick();
  assert.equal(
    f.plugin.settings.localZoteroHeartbeats["user:1"].libraryVersion,
    1,
  );
  f.failSave(false);
  await f.tick();
  assert.equal(
    f.plugin.settings.localZoteroHeartbeats["user:1"].libraryVersion,
    2,
  );
  assert.equal(f.refreshes, 2);
});

test("manual sync interrupts an active change reconciliation without advancing its checkpoint", async () => {
  const f = fixture();
  f.start();
  await f.tick();
  f.setVersion(2);
  let release!: () => void;
  f.holdRefresh(
    new Promise<void>((resolve) => {
      release = resolve;
    }),
  );
  const pending = f.tick();
  while (f.refreshes === 0) await Promise.resolve();
  f.plugin.isBulkLibrarySyncRunning = () => true;
  release();
  await pending;
  assert.equal(
    f.plugin.settings.localZoteroHeartbeats["user:1"].libraryVersion,
    1,
  );
  assert.equal(f.plugin.localLiveSyncApplyingChanges, false);
  f.plugin.isBulkLibrarySyncRunning = () => false;
  f.runtime.notifyLocalLiveSyncAfterBulkSync(f.plugin as never);
  await f.tick();
  assert.equal(f.refreshes, 2);
});

test("unavailable note metadata does not block later notes and keeps the checkpoint pending", async () => {
  const f = fixture();
  Object.assign(f.plugin.settings.itemFileMap, {
    "user/1/EFGH5678": {
      filePath: "Papers/Synthetic.md",
      zoteroItemKey: "EFGH5678",
      zoteroVersion: 0,
    },
  });
  f.start();
  await f.tick();
  f.setVersion(2);
  f.skipRefreshes(1);
  await f.tick();
  assert.equal(f.refreshes, 1, "the later note still receives its update");
  assert.equal(
    f.plugin.settings.localZoteroHeartbeats["user:1"].libraryVersion,
    1,
  );
  await f.tick();
  assert.equal(f.refreshes, 3);
  assert.equal(
    f.plugin.settings.localZoteroHeartbeats["user:1"].libraryVersion,
    2,
  );
});

test("a missing library refreshes discovery so stale libraries do not stall every heartbeat", async () => {
  const f = fixture();
  f.plugin.localSyncLibraries = [
    { type: "group", id: "2", identity: "group:2", name: "Synthetic group" },
  ];
  f.setFailure(new ApiError("Library not found", 404));
  f.start();
  await f.tick();
  assert.equal(f.discoveries, 1);
  assert.equal(f.plugin.localSyncLibraries[0].identity, "user:1");
  f.setFailure(null);
  await f.tick();
  assert.equal(f.plugin.localLiveSyncError, null);
  assert.equal(
    f.plugin.settings.localZoteroHeartbeats["user:1"].libraryVersion,
    1,
  );
  assert.equal(f.refreshes, 0);
  assert.equal(
    f.discoveries,
    1,
    "unchanged heartbeats do not repeat discovery",
  );
});

test("a skipped note alone does not display syncing or advance its checkpoint", async () => {
  const f = fixture();
  f.start();
  await f.tick();
  f.setVersion(2);
  f.skipRefreshes(1);
  await f.tick();
  assert.deepEqual(f.busyStates, []);
  assert.equal(
    f.plugin.settings.localZoteroHeartbeats["user:1"].libraryVersion,
    1,
  );
});
