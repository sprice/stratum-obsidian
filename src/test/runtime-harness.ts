import { buildSync } from "esbuild";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

// Exercise the shipped modules with only Obsidian's host APIs replaced.
export function loadRuntime<T>(
  entry: string,
  obsidian: Record<string, unknown>,
  globals: Record<string, unknown> = {},
  platform: "node" | "browser" = "node",
): T {
  const result = buildSync({
    entryPoints: [fileURLToPath(new URL(`../${entry}`, import.meta.url))],
    bundle: true,
    write: false,
    platform,
    format: "cjs",
    supported: { "dynamic-import": false },
    external: ["obsidian"],
    define: Object.fromEntries(
      [
        "__STRATUM_WEB_APP_URL__",
        "__STRATUM_SUPABASE_URL__",
        "__STRATUM_API_BASE_URL__",
        "__STRATUM_SUPABASE_PUBLISHABLE_KEY__",
      ].map((key) => [key, JSON.stringify("https://example.test")]),
    ),
  });
  const module = { exports: {} };
  runInNewContext(result.outputFiles[0].text, {
    module,
    exports: module.exports,
    require: (name: string) => {
      if (name !== "obsidian") throw new Error(`Unexpected import: ${name}`);
      return obsidian;
    },
    console,
    URL,
    URLSearchParams,
    performance,
    window: { setTimeout: () => 1, clearTimeout: () => {} },
    ...globals,
  });
  return module.exports as T;
}
