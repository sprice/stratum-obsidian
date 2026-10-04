import assert from "node:assert/strict";
import test from "node:test";
import { loadRuntime } from "./runtime-harness";

for (const unload of ["before", "during", "never"] as const) {
  test(`sidebar activation respects plugin unload: ${unload}`, async () => {
    class HostComponent {}
    const { default: StratumPlugin } = loadRuntime<typeof import("../plugin")>(
      "plugin.ts",
      new Proxy<Record<string, unknown>>({}, { get: () => HostComponent }),
    );
    let opened = 0;
    let revealed = 0;
    let release!: () => void;
    const loading = new Promise<void>((resolve) => {
      release = resolve;
    });
    const leaf = {
      setViewState: () => {
        opened++;
        return loading;
      },
    };
    const plugin = {
      isUnloaded: unload === "before",
      app: {
        workspace: {
          getLeavesOfType: () => [leaf],
          revealLeaf: () => {
            revealed++;
            return Promise.resolve();
          },
        },
      },
    };
    const activation = StratumPlugin.prototype.activateView.call(
      plugin as never,
    );
    if (unload === "during") plugin.isUnloaded = true;
    release();
    await activation;
    assert.equal(opened, unload === "before" ? 0 : 1);
    assert.equal(revealed, unload === "never" ? 1 : 0);
  });
}
