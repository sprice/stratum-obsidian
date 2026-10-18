import assert from "node:assert/strict";
import test from "node:test";
import type * as LiveSync from "../plugin-local-live-sync";
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
  let source = "first";
  let failure: Error | null = null;
  let refreshFails = false;
  let refreshes = 0;
  let focus: (() => void) | undefined;
  let hold: Promise<void> | undefined;
  let requests = 0;
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
      itemFileMap: {
        "user/1/ABCD1234": {
          filePath: file.path,
          zoteroItemKey: "ABCD1234",
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
    localLiveSyncSnapshots: new Map<string, string>(),
    localLiveSyncError: null as string | null,
    isBulkLibrarySyncRunning: () => false,
    refreshViews: () => {},
    registerDomEvent: (_window: unknown, _event: string, cb: () => void) => {
      focus = cb;
    },
    app: {
      vault: { getAbstractFileByPath: () => file },
      metadataCache: { getFileCache: () => null },
    },
  };
  const runtime = loadRuntime<typeof LiveSync>(
    "plugin-local-live-sync.ts",
    { Platform: { isDesktopApp: true }, TFile: FakeFile },
    {
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
        loadLocalZoteroLibraries: async () => {
          requests++;
          await hold;
          if (failure) throw failure;
          return { userId: "1", libraries: [library] };
        },
        loadLocalZoteroNoteSnapshot: () => Promise.resolve(source),
      },
      "./plugin-local-sync": {
        refreshLocalSyncLibraries: () => {
          plugin.localSyncLibraries = [library];
          return Promise.resolve([library]);
        },
      },
      "./plugin-libraries": { getLibraryAutoSyncState: () => state },
      "./plugin-note-refresh": {
        refreshOpenedLiteratureNote: (
          _plugin: unknown,
          _file: unknown,
          options: { background: boolean },
        ) => {
          assert.equal(options.background, true);
          refreshes++;
          state.lastError = refreshFails ? "Failed" : null;
          return Promise.resolve();
        },
      },
    },
  );
  return {
    plugin,
    runtime,
    setSource: (value: string) => {
      source = value;
    },
    setFailure: (value: Error | null) => {
      failure = value;
    },
    failRefresh: (value: boolean) => {
      refreshFails = value;
    },
    hold: (value: Promise<void>) => {
      hold = value;
    },
    get refreshes() {
      return refreshes;
    },
    get requests() {
      return requests;
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

test("polling catches up on startup, skips unchanged content, and resumes after Zotero closes", async () => {
  const f = fixture();
  f.start();
  await f.tick();
  assert.equal(f.refreshes, 1);
  assert.equal(f.delay, 30_000);
  await f.tick();
  assert.equal(f.refreshes, 1);
  f.setFailure(new Unavailable("Closed"));
  await f.tick();
  assert.equal(f.delay, 60_000);
  assert.match(f.plugin.localLiveSyncError!, /Saved notes remain available/);
  assert.equal(f.plugin.localLiveSyncSnapshots.size, 1);
  f.setSource("edited offline");
  f.setFailure(null);
  f.focus();
  assert.equal(f.delay, 0);
  await f.tick();
  assert.equal(f.refreshes, 2);
  assert.equal(f.plugin.localLiveSyncError, null);
});

test("failed refresh retains the baseline and retries; bulk sync defers polling", async () => {
  const f = fixture();
  f.start();
  await f.tick();
  f.setSource("changed");
  f.failRefresh(true);
  await f.tick();
  assert.equal(
    f.plugin.localLiveSyncSnapshots.get("23119/user/1/ABCD1234"),
    "first",
  );
  f.plugin.isBulkLibrarySyncRunning = () => true;
  await f.tick();
  assert.equal(f.refreshes, 2);
  f.plugin.isBulkLibrarySyncRunning = () => false;
  f.failRefresh(false);
  f.runtime.notifyLocalLiveSyncAfterBulkSync(f.plugin as never);
  await f.tick();
  assert.equal(f.refreshes, 3);
  assert.equal(
    f.plugin.localLiveSyncSnapshots.get("23119/user/1/ABCD1234"),
    "changed",
  );
});

test("polls never overlap and unload prevents writes and rescheduling", async () => {
  const f = fixture();
  let resolve!: () => void;
  f.hold(
    new Promise<void>((done) => {
      resolve = done;
    }),
  );
  f.start();
  const pending = f.tick();
  f.focus();
  const duplicate = f.tick();
  assert.equal(f.requests, 1);
  f.plugin.isUnloaded = true;
  resolve();
  await Promise.all([pending, duplicate]);
  assert.equal(f.refreshes, 0);
  assert.equal(f.timer, undefined);
});

test("disabled and unsupported APIs show actionable status without deleting snapshots", async () => {
  const f = fixture();
  f.start();
  await f.tick();
  f.setFailure(new ApiError("Disabled", 403));
  await f.tick();
  assert.match(f.plugin.localLiveSyncError!, /Enable Zotero/);
  f.setFailure(new ApiError("Not found", 404));
  await f.tick();
  assert.match(f.plugin.localLiveSyncError!, /Zotero 7 or later/);
  assert.equal(f.plugin.localLiveSyncSnapshots.size, 1);
});

test("opening Zotero after an offline start discovers libraries and catches up", async () => {
  const f = fixture();
  f.plugin.localSyncLibraries = [];
  f.setFailure(new Unavailable("Closed"));
  f.start();
  await f.tick();
  assert.equal(f.refreshes, 0);
  f.setFailure(null);
  await f.tick();
  assert.equal(f.plugin.localSyncLibraries.length, 1);
  assert.equal(f.refreshes, 1);
});

test("account and port changes invalidate an in-flight poll", async () => {
  for (const change of ["account", "port"]) {
    const f = fixture();
    let release!: () => void;
    f.hold(
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );
    f.start();
    const pending = f.tick();
    if (change === "account") f.plugin.settings.accountId = "account-b";
    else f.plugin.settings.zoteroLocalApiPort = 23120;
    release();
    await pending;
    assert.equal(f.refreshes, 0);
    assert.equal(f.plugin.localLiveSyncSnapshots.size, 0);
  }
});
