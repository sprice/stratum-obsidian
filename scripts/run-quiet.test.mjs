import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const runner = fileURLToPath(new URL("./run-quiet.mjs", import.meta.url));
const env = {
  ...process.env,
  npm_lifecycle_event: "fixture",
  STRATUM_VERBOSE: "0",
  CI: "",
};
function run(code, args = [], overrides = {}) {
  return spawnSync(
    process.execPath,
    [runner, process.execPath, "-e", code, ...args],
    {
      env: { ...env, ...overrides },
      encoding: "utf8",
    },
  );
}
function retainedLog(result) {
  const path = result.stderr.match(/Full log: (.+)/)?.[1];
  assert.ok(path, "failure reports its complete log");
  return path;
}

test("successful checks suppress noisy stdout/stderr and delete their logs", () => {
  const folder = mkdtempSync(join(tmpdir(), "quiet-fixture-"));
  try {
    const result = run(
      'console.log("success noise"); console.error("warning noise")',
      [],
      { TMPDIR: folder, TMP: folder, TEMP: folder },
    );
    assert.equal(result.status, 0);
    assert.equal(result.stdout, "PASS fixture\n");
    assert.equal(result.stderr, "");
    // A success must leave no raw logs behind.
    assert.equal(existsSync(folder), true);
    assert.deepEqual(readdirSync(folder), []);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test("failure preserves the exit code and full log while bounding terminal diagnostics", () => {
  const result = run(
    'console.log("first diagnostic"); for(let i=0;i<2000;i++) console.log("detail "+i); console.error("last diagnostic"); process.exitCode=7',
  );
  const log = retainedLog(result);
  try {
    assert.equal(result.status, 7);
    assert.match(result.stderr, /FAIL fixture \(exit 7\)/);
    assert.match(result.stderr, /last diagnostic/);
    assert.ok(result.stderr.length < 17000);
    const complete = readFileSync(log, "utf8");
    assert.match(complete, /^first diagnostic/);
    assert.match(complete, /detail 1999/);
    if (process.platform !== "win32")
      assert.equal(statSync(log).mode & 0o777, 0o600);
  } finally {
    rmSync(dirname(log), { recursive: true, force: true });
  }
});

test("verbose opt-in streams stdout and stderr without log redirection", () => {
  const result = run(
    'console.log("visible stdout"); console.error("visible stderr")',
    [],
    { STRATUM_VERBOSE: "1" },
  );
  assert.equal(result.status, 0);
  assert.equal(result.stdout, "visible stdout\n");
  assert.equal(result.stderr, "visible stderr\n");
});

test("arguments are forwarded literally without shell interpretation", () => {
  const args = [
    "space separated",
    "$(echo unwanted)",
    "; exit 99",
    "quote'\"value",
  ];
  const result = run(
    "console.log(JSON.stringify(process.argv.slice(1)))",
    args,
    { STRATUM_VERBOSE: "1" },
  );
  assert.equal(result.status, 0);
  assert.deepEqual(JSON.parse(result.stdout), args);
});

test("spawn errors fail visibly rather than reporting success", () => {
  const result = spawnSync(
    process.execPath,
    [runner, "stratum-command-that-does-not-exist"],
    { env, encoding: "utf8" },
  );
  const log = retainedLog(result);
  try {
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Could not start/);
    assert.match(result.stderr, /FAIL fixture/);
  } finally {
    rmSync(dirname(log), { recursive: true, force: true });
  }
});

test("pnpm entry-point execution forwards script arguments and runs in the current package", () => {
  assert.ok(process.env.npm_execpath, "run this suite with pnpm");
  const folder = mkdtempSync(join(tmpdir(), "quiet-package-"));
  try {
    writeFileSync(
      join(folder, "package.json"),
      JSON.stringify({
        name: "quiet-fixture",
        scripts: { fixture: 'node -e "console.log(process.argv[1])"' },
      }),
    );
    const result = spawnSync(
      process.execPath,
      [runner, "pnpm", "run", "fixture", "a value"],
      { cwd: folder, env: { ...env, STRATUM_VERBOSE: "1" }, encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /a value/);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test(
  "termination is forwarded to the command and returns a nonzero signal status",
  { skip: process.platform === "win32" },
  async () => {
    const folder = mkdtempSync(join(tmpdir(), "quiet-signal-"));
    const ready = join(folder, "ready");
    const child = spawn(
      process.execPath,
      [
        runner,
        process.execPath,
        "-e",
        "require('node:fs').writeFileSync(process.argv[1], 'ready'); setInterval(()=>{},1000)",
        ready,
      ],
      { env, stdio: ["ignore", "pipe", "pipe"] },
    );
    let stderr = "";
    child.stderr.on("data", (data) => {
      stderr += data;
    });
    const closed = new Promise((resolve) =>
      child.once("close", (code) => resolve(code)),
    );
    try {
      const deadline = Date.now() + 5000;
      while (!existsSync(ready) && Date.now() < deadline)
        await new Promise((resolve) => setTimeout(resolve, 10));
      assert.ok(existsSync(ready), "child started");
      child.kill("SIGTERM");
      assert.equal(await closed, 143);
      const log = retainedLog({ stderr });
      rmSync(dirname(log), { recursive: true, force: true });
    } finally {
      child.kill("SIGTERM");
      rmSync(folder, { recursive: true, force: true });
    }
  },
);

test("CI keeps complete failure diagnostics in the job output", () => {
  const result = run(
    'console.log("first diagnostic"); for(let i=0;i<200;i++) console.log("detail "+i); process.exitCode=2',
    [],
    { CI: "true" },
  );
  const log = retainedLog(result);
  try {
    assert.equal(result.status, 2);
    assert.match(result.stderr, /first diagnostic/);
    assert.match(result.stderr, /detail 199/);
  } finally {
    rmSync(dirname(log), { recursive: true, force: true });
  }
});
