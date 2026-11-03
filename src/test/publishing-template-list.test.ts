import assert from "node:assert/strict";
import test from "node:test";
import { installedTemplateGroups } from "../publishing-template-list";
import { readPublishingTemplates } from "../publish-templates";
import { declarativePackageFixture } from "./publication-package-fixture";
import { installationFixture } from "./publication-installation-fixture";
import {
  onTemplateInstalled,
  notifyTemplateInstalled,
} from "../publishing-template-events";
import type StratumPlugin from "../plugin";

test("installed list combines source formats without merging version identities or variant rows", () => {
  const { manifest: p } = declarativePackageFixture();
  const legacy = installationFixture(p.id, p.version).manifest;
  const state = readPublishingTemplates({
    installations: [legacy],
    packageInstallations: [
      { manifest: p, sha256: "a".repeat(64) },
      { manifest: { ...p, version: "2.0" }, sha256: "b".repeat(64) },
    ],
  });
  const before = JSON.stringify(state);
  const groups = installedTemplateGroups(state);
  assert.equal(groups.length, 3, "two built-ins and one registry family");
  const registry = groups[2];
  assert.equal(registry.rows.length, 3);
  assert.equal(new Set(registry.rows.map((row) => row.id)).size, 3);
  assert.equal(registry.rows[1].id, `download:${p.id}:${p.version}`);
  assert.equal(registry.rows[2].version, "2.0");
  assert.equal(
    JSON.stringify(state),
    before,
    "presentation must not migrate saved state",
  );
});

test("installation refresh listeners are scoped to the plugin and unsubscribe on close", () => {
  const plugin = {} as StratumPlugin;
  const other = {} as StratumPlugin;
  let updates = 0;
  const stop = onTemplateInstalled(plugin, () => updates++);
  notifyTemplateInstalled(other);
  assert.equal(updates, 0);
  notifyTemplateInstalled(plugin);
  assert.equal(updates, 1);
  stop();
  notifyTemplateInstalled(plugin);
  assert.equal(updates, 1);
});
