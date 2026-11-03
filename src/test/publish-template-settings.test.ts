import { packageFixture } from "./publication-package-fixture";
import { readPublishingTemplates } from "../publish-templates";
import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import { loadRuntime } from "./runtime-harness";
import { installationFixture } from "./publication-installation-fixture";

function setup(
  packageListing: () => Promise<{
    items: { id: string; name: string; version: string; sha256: string }[];
    offline: boolean;
  }> = () => Promise.resolve({ items: [], offline: false }),
) {
  let now = 0;
  let nextTimer = 0;
  const timers = new Map<number, { at: number; callback: () => void }>();
  const requests: {
    resolve: (result: { items: unknown[]; offline: boolean }) => void;
    reject: (error: unknown) => void;
  }[] = [];
  class Modal {
    closed = false;
    close() {
      this.closed = true;
      (this as unknown as { onClose(): void }).onClose();
    }
    modalEl = { addClass() {} };
    contentEl = { empty() {} };
  }
  type Subject = {
    closed: boolean;
    status: string;
    families: { id: string; versionCount: number }[];
    packages: { id: string; name: string; version: string; sha256: string }[];
    releases: { version: string }[];
    registrySetting: { setDesc: (message: string) => void };
    selectedFamily: string;
    selectedVersions: Set<string>;
    installationStatus: string;
    installSelected: () => Promise<void>;
    renderList: () => void;
    removePackage: (id: string, version: string) => Promise<void>;
    onOpen: () => void;
    onClose: () => void;
    refreshRegistry: () => Promise<void>;
    chooseFamily: (id: string) => Promise<void>;
  };
  const { PublishingTemplatesModal } = loadRuntime<{
    PublishingTemplatesModal: new (plugin: unknown) => Subject;
  }>(
    "publish-template-settings.ts",
    { Modal, Platform: { isDesktop: true } },
    {
      AbortController,
      TextEncoder,
      TextDecoder,
      window: {
        setTimeout(callback: () => void, delay: number) {
          const id = ++nextTimer;
          timers.set(id, { at: now + delay, callback });
          return id;
        },
        clearTimeout(id: number) {
          timers.delete(id);
        },
      },
    },
    "node",
    {
      "./publication-package-catalog": {
        packageRegistryListing: packageListing,
      },
      "./publication-resources": {
        publicationResourceCache: () => ({}),
        installedTemplateResources: async () => {},
      },
      "./publication-registry-client": {
        registryInstallation: (
          _download: unknown,
          id: string,
          version: string,
        ) =>
          Promise.resolve(
            installationFixture(id, version.replace(/-r\d+$/, "")).manifest,
          ),
      },
      "./publication-registry-cache": {
        registryListing: () =>
          new Promise((resolve, reject) => requests.push({ resolve, reject })),
      },
    },
  );
  const plugin = {
    app: {},
    settings: { publishingTemplates: undefined as unknown },
    saveSettings: async () => {},
    refreshViews() {},
  };
  const modal = new PublishingTemplatesModal(plugin);
  const displayed: string[] = [];
  modal.renderList = () => displayed.push(modal.status);
  const description = { text: "" };
  modal.registrySetting = {
    setDesc: (message: string) => {
      description.text = message;
    },
  };
  return {
    createModal: () => new PublishingTemplatesModal(plugin),
    modal,
    plugin,
    requests,
    displayed,
    description,
    advance: (ms: number) => {
      now += ms;
      for (const [id, timer] of timers) {
        if (timer.at <= now) {
          timers.delete(id);
          timer.callback();
        }
      }
    },
  };
}

const guidance = "Choose a template, then select versions to add.";

test("initial render and fast registry success keep normal guidance", async () => {
  const { modal, requests, displayed, advance } = setup();
  modal.onOpen();
  requests[0].resolve({ items: [{ id: "sample" }], offline: false });
  await setImmediate();
  advance(3000);
  assert.ok(displayed.length >= 2);
  assert.ok(displayed.every((text) => text === guidance));
});

test("a slow registry warns at three seconds and recovers on late success", async () => {
  const { modal, requests, advance, displayed, description } = setup();
  const pending = modal.refreshRegistry();
  const renders = displayed.length;
  advance(2999);
  assert.equal(modal.status, guidance);
  advance(1);
  assert.match(modal.status, /registry is unavailable/);
  assert.equal(description.text, modal.status);
  assert.equal(
    displayed.length,
    renders,
    "a warning preserves the current controls",
  );
  requests[0].resolve({ items: [{ id: "sample" }], offline: false });
  await pending;
  assert.equal(modal.status, guidance);
});

test("overlapping refreshes retain the latest family listing", async () => {
  const { modal, requests } = setup();
  const older = modal.refreshRegistry();
  const newer = modal.refreshRegistry();
  requests[1].resolve({ items: [{ id: "newer" }], offline: false });
  await newer;
  requests[0].resolve({ items: [], offline: true });
  await older;
  assert.equal(modal.families[0].id, "newer");
  assert.equal(modal.status, guidance);
});

for (const offline of [false, true]) {
  test(`fast ${offline ? "cached fallback" : "failure"} waits three seconds before warning`, async () => {
    const { modal, requests, advance } = setup();
    const pending = modal.refreshRegistry();
    if (offline) requests[0].resolve({ items: [], offline: true });
    else requests[0].reject("unavailable");
    await pending;
    advance(2999);
    assert.equal(modal.status, guidance);
    advance(1);
    assert.match(modal.status, offline ? /Offline/ : /registry is unavailable/);
  });
}

test("version loading keeps guidance and ignores an older registry response", async () => {
  const { modal, requests, advance } = setup();
  const families = modal.refreshRegistry();
  const versions = modal.chooseFamily("sample");
  assert.match(modal.status, /^Select versions/);
  requests[0].resolve({ items: [], offline: false });
  await families;
  assert.match(modal.status, /^Select versions/);
  advance(3000);
  assert.match(modal.status, /Could not load versions/);
  requests[1].resolve({ items: [], offline: false });
  await versions;
  assert.match(modal.status, /^Select versions/);
});

test("closing the modal cancels its pending status update", async () => {
  const { modal, requests, displayed, advance } = setup();
  const pending = modal.refreshRegistry();
  modal.onClose();
  const renders = displayed.length;
  advance(3000);
  requests[0].resolve({ items: [], offline: false });
  await pending;
  assert.equal(displayed.length, renders);
  assert.equal(modal.status, guidance);
});

test("sequential installations report the total for the selected family", async () => {
  const { modal, plugin } = setup();
  modal.selectedFamily = "example";
  for (const version of ["1.0-r1", "2.0-r1"]) {
    modal.selectedVersions.add(version);
    await modal.installSelected();
  }
  assert.equal(
    modal.installationStatus,
    "Added 1 version. 2 versions of this template are installed.",
  );
  modal.selectedFamily = "another";
  modal.selectedVersions.add("1.0-r1");
  await modal.installSelected();
  assert.equal(
    modal.installationStatus,
    "Added 1 version. 1 version of this template is installed.",
  );
  plugin.saveSettings = () =>
    Promise.reject(new Error("Synthetic save failure"));
  modal.selectedVersions.add("2.0-r1");
  await modal.installSelected();
  assert.match(modal.installationStatus, /Installation failed/);
  assert.doesNotMatch(modal.installationStatus, /Added/);
});

test("package removal uses current settings and stable identity after a reinstall", async () => {
  const { modal, plugin } = setup();
  const { p } = packageFixture();
  const installed = { manifest: p, sha256: "a".repeat(64) };
  plugin.settings.publishingTemplates = readPublishingTemplates({
    packageInstallations: [installed],
  });
  const newer = structuredClone(installed);
  newer.manifest.version = "2.0";
  for (const asset of newer.manifest.assets)
    asset.download = asset.download?.replace("/1.0/", "/2.0/");
  plugin.settings.publishingTemplates = readPublishingTemplates({
    ...(plugin.settings.publishingTemplates as object),
    packageInstallations: [structuredClone(installed), newer],
    enabledIds: ["download:unfamiliar:1.0", "download:unfamiliar:2.0"],
  });
  await modal.removePackage(p.id, p.version);
  const state = readPublishingTemplates(plugin.settings.publishingTemplates);
  assert.deepEqual(
    state.packageInstallations?.map((i) => i.manifest.version),
    ["2.0"],
  );
  assert.deepEqual(state.enabledIds, ["download:unfamiliar:2.0"]);
});

test("discovery combines packages and legacy families, preferring packages for a migrated family", async () => {
  const pin = {
    id: "unfamiliar",
    name: "Synthetic package",
    version: "1.0",
    sha256: "a".repeat(64),
  };
  const { modal, requests } = setup(() =>
    Promise.resolve({
      items: [pin, { ...pin, version: "2.0" }],
      offline: false,
    }),
  );
  const pending = modal.refreshRegistry();
  requests[0].resolve({
    items: [
      { id: "legacy", name: "Legacy", versionCount: 1 },
      { id: pin.id, name: "Old family", versionCount: 1 },
    ],
    offline: false,
  });
  await pending;
  assert.deepEqual(
    Array.from(modal.families, (f) => f.id),
    ["legacy", pin.id],
  );
  assert.equal(modal.families[1].versionCount, 2);
  await modal.chooseFamily(pin.id);
  assert.deepEqual(
    Array.from(modal.releases, (r) => r.version),
    ["2.0", "1.0"],
  );
  assert.equal(
    requests.length,
    1,
    "package choices need no legacy version request",
  );
});

for (const failed of ["legacy", "package"] as const) {
  test(`discovery retains the working catalog when ${failed} discovery fails`, async () => {
    const pin = {
      id: "unfamiliar",
      name: "Synthetic package",
      version: "1.0",
      sha256: "a".repeat(64),
    };
    const { modal, requests, advance } = setup(() => {
      if (failed === "package") return Promise.reject(Error("offline"));
      return Promise.resolve({ items: [pin], offline: false });
    });
    const pending = modal.refreshRegistry();
    if (failed === "legacy") requests[0].reject(Error("offline"));
    else
      requests[0].resolve({
        items: [{ id: "legacy", name: "Legacy", versionCount: 1 }],
        offline: false,
      });
    await pending;
    advance(3000);
    assert.equal(modal.families[0].id, failed === "legacy" ? pin.id : "legacy");
    assert.match(modal.status, /unavailable/);
  });
}

test("cached package versions stay browsable with an offline status", async () => {
  const pin = {
    id: "unfamiliar",
    name: "Synthetic package",
    version: "1.0",
    sha256: "a".repeat(64),
  };
  const { modal, requests, advance } = setup(() =>
    Promise.resolve({
      items: [pin],
      offline: true,
    }),
  );
  const pending = modal.refreshRegistry();
  requests[0].resolve({ items: [], offline: false });
  await pending;
  await modal.chooseFamily(pin.id);
  advance(3000);
  assert.match(modal.status, /Offline.*cached package/);
  assert.equal(modal.releases[0].version, "1.0");
});

test("opening the installed-template shortcut replaces the previous manager", () => {
  const f = setup();
  f.modal.onOpen();
  const next = f.createModal();
  next.renderList = () => {};
  next.onOpen();
  assert.equal(f.modal.closed, true);
  assert.equal(next.closed, false);
  next.onClose();
});
