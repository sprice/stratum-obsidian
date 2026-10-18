import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
  rename,
  readdir,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { parse } from "yaml";
import {
  prepareCiCache as prepare,
  publishingFingerprint,
} from "./ci-cache-prepare.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const cachedTasks = Object.keys(manifest.scripts).filter(
  (name) =>
    manifest.scripts[name] === "wireit" && manifest.wireit[name]?.command,
);
const binary = fileURLToPath(import.meta.resolve("wireit/bin/wireit.js"));
const prepareCiCache = (
  root,
  env,
  fingerprint = async () => "synthetic-tools-v1",
) => prepare(root, env, fingerprint);
const preparationEnv = { npm_config_user_agent: "pnpm/10.12.4", CI: "true" };

async function put(root, file, contents) {
  await mkdir(dirname(join(root, file)), { recursive: true });
  await writeFile(join(root, file), contents);
}

async function fixture(t, name) {
  const directory = await mkdtemp(join(tmpdir(), "stratum-ci-cache-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await put(
    directory,
    "package.json",
    JSON.stringify({
      ...manifest,
      wireit: {
        ...manifest.wireit,
        [name]: { ...manifest.wireit[name], command: "node probe.mjs" },
      },
    }),
  );
  await put(directory, "pnpm-lock.yaml", "lockfileVersion: '9.0'\n");
  await put(directory, "src/example.ts", "export const value = 1;\n");
  await put(
    directory,
    "src/publication-installation-render.ts",
    "synthetic template\n",
  );
  await put(
    directory,
    "probe.mjs",
    `
    import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
    import { dirname } from 'node:path';
    for (const path of ${JSON.stringify(manifest.wireit[name].output.map((p) => p.replace("*.png", "synthetic.png")))}) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, 'synthetic output');
    }
    appendFileSync('executions', 'run\\n');
    if (existsSync('fail')) process.exit(7);
  `,
  );
  await prepareCiCache(directory, preparationEnv);
  return directory;
}

async function run(directory, name, extraEnv = {}) {
  const child = spawn(process.execPath, [binary], {
    cwd: directory,
    env: {
      ...process.env,
      CI: "true",
      // Keep the timezone-change assertion independent of the caller's timezone.
      TZ: "UTC",
      STRATUM_DEBUG: "",
      WIREIT_CACHE: "local",
      WIREIT_LOGGER: "simple",
      npm_package_json: join(directory, "package.json"),
      npm_lifecycle_event: name,
      ...extraEnv,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk;
  });
  child.stderr.on("data", (chunk) => {
    output += chunk;
  });
  const [code] = await once(child, "close");
  return { code, output };
}

for (const name of cachedTasks) {
  test(`${name}: cache invalidates for changes, failures never satisfy checks`, async (t) => {
    const directory = await fixture(t, name);
    let executions = 0;
    async function expectRun(increment, env = {}, successful = true) {
      const result = await run(directory, name, env);
      assert.equal(result.code === 0, successful, result.output);
      executions += increment;
      const lines = (await readFile(join(directory, "executions"), "utf8"))
        .trim()
        .split("\n");
      assert.equal(lines.length, executions, result.output);
    }
    await expectRun(1);
    await expectRun(0);
    // A fresh checkout must restore a cached result, not just use local freshness.
    for (const entry of await readdir(join(directory, ".wireit")))
      await rm(join(directory, ".wireit", entry, "fingerprint"), {
        force: true,
      });
    await expectRun(0);
    for (const output of manifest.wireit[name].output) {
      const path = join(directory, output.replace("*.png", "synthetic.png"));
      await rm(path);
      await expectRun(0);
      assert.equal(await readFile(path, "utf8"), "synthetic output");
    }
    const sourceTask =
      name !== "ci:test-tooling" && name !== "ci:publishing-preflight";
    for (const file of [
      "src/example.ts",
      "eslint.config.mts",
      "tsconfig.json",
      "styles.css",
      "scripts/helper.mjs",
      ".github/workflows/lint.yml",
      "pnpm-lock.yaml",
      "src/publication-installation-render.ts",
      ".prettierignore",
      ...(name === "ci:build"
        ? [
            "esbuild.config.mjs",
            "plugin.config.json",
            ".env",
            "THIRD_PARTY_NOTICES.md",
            "licenses/synthetic.txt",
          ]
        : []),
    ]) {
      await put(directory, file, "changed input\n");
      // Independent expectations catch accidentally removed input declarations.
      const relevant =
        file === "pnpm-lock.yaml" ||
        (sourceTask && (file.startsWith("src/") || file === "tsconfig.json")) ||
        (["ci:lint-review", "ci:scorecard"].includes(name) &&
          file === "eslint.config.mts") ||
        (["ci:scorecard", "ci:test-browser"].includes(name) &&
          file === "styles.css") ||
        (name === "ci:format" && file === ".prettierignore") ||
        (name === "ci:test-tooling" &&
          (file.startsWith("scripts/") || file.startsWith(".github/"))) ||
        (name === "ci:build" &&
          [
            "esbuild.config.mjs",
            "plugin.config.json",
            ".env",
            "THIRD_PARTY_NOTICES.md",
            "licenses/synthetic.txt",
          ].includes(file));
      await expectRun(relevant ? 1 : 0);
    }
    await put(directory, "src/added.ts", "new file\n");
    await expectRun(sourceTask ? 1 : 0);
    await rename(
      join(directory, "src/added.ts"),
      join(directory, "src/renamed.ts"),
    );
    await expectRun(sourceTask ? 1 : 0);
    await rm(join(directory, "src/renamed.ts"));
    // This returns to an earlier input set, so reusing its success is correct.
    await expectRun(0);
    await prepareCiCache(directory, {
      ...preparationEnv,
      ImageVersion: "new-image",
    });
    await expectRun(1);
    const changedManifest = JSON.parse(
      await readFile(join(directory, "package.json"), "utf8"),
    );
    changedManifest.description = "Changed dependency manifest input";
    await put(directory, "package.json", JSON.stringify(changedManifest));
    await expectRun(1);
    changedManifest.wireit[name].command = "node probe.mjs --changed-command";
    await put(directory, "package.json", JSON.stringify(changedManifest));
    await expectRun(1);
    await put(
      directory,
      "new-tests/outside-source.test.ts",
      "synthetic test\n",
    );
    await prepareCiCache(directory, {
      ...preparationEnv,
      ImageVersion: "new-image",
    });
    await expectRun(1);
    if (manifest.wireit[name].files.includes(".ci-cache/publishing.json")) {
      await prepareCiCache(
        directory,
        { ...preparationEnv, ImageVersion: "new-image" },
        async () => "synthetic-tools-v2",
      );
      await expectRun(1);
    }
    await expectRun(name === "ci:build" ? 1 : 0, { STRATUM_DEBUG: "true" });
    await expectRun(1, { TZ: "Pacific/Honolulu" });
    await expectRun(0, { TZ: "Pacific/Honolulu" });
    await put(directory, "fail", "");
    await put(directory, ".npmrc", "failing revision\n");
    await expectRun(1, {}, false);
    await expectRun(1, {}, false);
    await rm(join(directory, "fail"));
    await expectRun(1);
  });
}

test("preparation needs no generated assets on cache hits and records no private environment", async (t) => {
  const directory = await fixture(t, "ci:typecheck");
  const assets = join(directory, "src/publication-templates/aastex/files.json");
  await run(directory, "ci:typecheck");
  await prepareCiCache(directory, {
    ...preparationEnv,
    SYNTHETIC_SECRET: "never-record",
  });
  await assert.rejects(readFile(assets), { code: "ENOENT" });
  assert.doesNotMatch(
    await readFile(join(directory, ".ci-cache/environment.json"), "utf8"),
    /never-record/,
  );
  assert.equal((await run(directory, "ci:typecheck")).code, 0);
  assert.equal(await readFile(join(directory, "executions"), "utf8"), "run\n");
  await assert.rejects(
    prepareCiCache(directory, { npm_config_user_agent: "pnpm/1.0.0" }),
    /pnpm@10.12.4/,
  );
});

test("GitHub cache service outage executes validation", async (t) => {
  const directory = await fixture(t, "ci:typecheck");
  const mediator = createServer((_request, response) => {
    response.setHeader("Content-Type", "application/json");
    response.end(
      JSON.stringify({
        caching: {
          github: {
            ACTIONS_RESULTS_URL: "https://127.0.0.1:1/",
            ACTIONS_RUNTIME_TOKEN: "synthetic-test-token",
          },
        },
      }),
    );
  });
  mediator.listen(0, "127.0.0.1");
  await once(mediator, "listening");
  t.after(() => mediator.close());
  const result = await run(directory, "ci:typecheck", {
    WIREIT_CACHE: "github",
    WIREIT_CACHE_GITHUB_CUSTODIAN_PORT: String(mediator.address().port),
  });
  assert.equal(result.code, 0, result.output);
  assert.match(
    result.output,
    /Network error from GitHub Actions cache service/,
  );
  assert.equal(await readFile(join(directory, "executions"), "utf8"), "run\n");
});

test("CI prepares cached inputs and disables task caches for tags", async () => {
  const workflow = parse(
    await readFile(join(root, ".github/workflows/lint.yml"), "utf8"),
  );
  assert.equal(workflow.jobs.build.env.WIREIT_CACHE, "none");
  const steps = workflow.jobs.build.steps;
  const setup = steps.find((step) => step.uses?.startsWith("google/wireit@"));
  assert.match(setup.uses, /@[a-f0-9]{40}$/);
  assert.match(setup.if, /!startsWith\(github.ref, 'refs\/tags\/'\)/);
  assert.match(setup.if, /inputs.uncached != true/);
  assert.match(setup.if, /vars.STRATUM_CI_CACHE_DISABLED != 'true'/);
  const check = steps.find((step) => step.run === "pnpm ci:check");
  assert(check);
  assert.match(check.if, /local-validation.outputs.validated != 'true'/);
  assert.deepEqual(
    new Set(manifest.wireit["ci:validate"].dependencies),
    new Set(cachedTasks),
  );
  assert.equal(workflow.jobs.build.env.WIREIT_PARALLEL, 2);
  const receipt = steps.find((step) => step.id === "local-validation");
  assert.match(receipt.if, /!startsWith/);
  assert.match(receipt.if, /inputs.uncached != true/);
  assert.match(receipt.if, /STRATUM_CI_CACHE_DISABLED/);

  assert.equal(
    workflow.jobs.release.steps.find((step) => step.name === "Build plugin")
      .run,
    "pnpm build",
  );
});

test("publishing fingerprints include stderr and every font, and reject unavailable tools", async () => {
  const env = {
    STRATUM_REQUIRE_PUBLISHING_TOOLS: "1",
    STRATUM_TEST_CHROME: "/synthetic/chrome",
  };
  const fingerprint = (extra = {}) =>
    publishingFingerprint(
      env,
      (exe) => ({
        status: 0,
        stdout: "Synthetic installed dependency",
        stderr: "",
        ...extra[exe],
      }),
      "linux",
    );
  const first = await fingerprint();
  assert.notEqual(
    first,
    await fingerprint({ pdftotext: { stderr: "new Poppler version" } }),
  );
  assert.notEqual(
    first,
    await fingerprint({ "fc-list": { stdout: "First font\nSecond font" } }),
  );
  assert.equal(
    await fingerprint({ "fc-list": { stdout: "First font\nSecond font" } }),
    await fingerprint({ "fc-list": { stdout: "Second font\nFirst font" } }),
  );
  await assert.rejects(
    publishingFingerprint(env, () => ({ status: 1 })),
    /Required CI publishing dependency/,
  );
  await assert.rejects(
    publishingFingerprint({}),
    /STRATUM_REQUIRE_PUBLISHING_TOOLS/,
  );
});

test("template cache content changes invalidate publishing inputs without exposing data", async (t) => {
  const directory = await fixture(t, "ci:test");
  const templates = await mkdtemp(
    join(tmpdir(), "stratum-synthetic-templates-"),
  );
  t.after(() => rm(templates, { recursive: true, force: true }));
  await put(templates, "synthetic.cls", "synthetic template version one");
  const env = { ...preparationEnv, STRATUM_TEST_TEMPLATE_CACHE: templates };
  await prepareCiCache(directory, env);
  const first = await readFile(
    join(directory, ".ci-cache/publishing.json"),
    "utf8",
  );
  assert.equal((await run(directory, "ci:test")).code, 0);
  await put(templates, "synthetic.cls", "synthetic template version two");
  await prepareCiCache(directory, env);
  const second = await readFile(
    join(directory, ".ci-cache/publishing.json"),
    "utf8",
  );
  assert.notEqual(first, second);
  assert(!second.includes(templates));
  assert(!second.includes("synthetic template"));
  assert.equal((await run(directory, "ci:test")).code, 0);
  assert.equal(
    await readFile(join(directory, "executions"), "utf8"),
    "run\nrun\n",
  );
});
