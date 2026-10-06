import { spawn } from "node:child_process";
import {
  closeSync,
  createReadStream,
  mkdtempSync,
  openSync,
  readSync,
  rmSync,
  statSync,
} from "node:fs";
import { constants, tmpdir } from "node:os";
import { basename, join } from "node:path";
import { createInterface } from "node:readline";

// Only use for finite checks. Interactive commands and data-producing commands
// must retain their stdout and stdin contracts.
const [command, ...args] = process.argv.slice(2);
if (!command) {
  console.error("Usage: run-quiet.mjs <command> [arguments...]");
  process.exit(1);
}
const started = performance.now();
const label = process.env.npm_lifecycle_event ?? basename(command);
const packageName = process.env.npm_package_name;
const summary = `PASS ${packageName ? `${packageName} / ` : ""}${label}`;
const verbose = process.env.STRATUM_VERBOSE === "1";
const folder = verbose ? null : mkdtempSync(join(tmpdir(), "stratum-check-"));
const log = folder && join(folder, "output.log");
const fd = log ? openSync(log, "w", 0o600) : null;
// pnpm may provide a JavaScript entry point or a standalone native executable.
// Only scripts need Node; native executables must be spawned directly.
const pnpmEntry = command === "pnpm" && process.env.npm_execpath;
function isNodeScript(path) {
  if (/\.(?:cjs|mjs|js)$/i.test(path)) return true;
  let entry;
  try {
    entry = openSync(path, "r");
    const prefix = Buffer.alloc(256);
    const length = readSync(entry, prefix, 0, prefix.length, 0);
    return /^#![^\r\n]*\bnode(?:\s|$)/.test(prefix.toString("utf8", 0, length));
  } catch {
    // Let spawn report an inaccessible or missing executable normally.
    return false;
  } finally {
    if (entry !== undefined) closeSync(entry);
  }
}
const pnpmScript = pnpmEntry && isNodeScript(pnpmEntry);
const child = spawn(
  pnpmScript ? process.execPath : pnpmEntry || command,
  pnpmScript ? [pnpmEntry, ...args] : args,
  {
    stdio: fd === null ? "inherit" : ["inherit", fd, fd],
    detached: process.platform !== "win32",
  },
);
if (fd !== null) closeSync(fd);
let interrupted = null;
let spawnFailed = false;
const forward = (signal) => {
  interrupted = signal;
  if (!child.pid) return;
  try {
    // Include the shell/tool children created by pnpm, not just its launcher.
    process.kill(process.platform === "win32" ? child.pid : -child.pid, signal);
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
};
const onInterrupt = () => forward("SIGINT");
const onTerminate = () => forward("SIGTERM");
process.on("SIGINT", onInterrupt);
process.on("SIGTERM", onTerminate);
child.once("error", (error) => {
  spawnFailed = true;
  console.error(`Could not start ${basename(command)}: ${error.message}`);
});
child.once("close", async (code, signal) => {
  process.off("SIGINT", onInterrupt);
  process.off("SIGTERM", onTerminate);
  const termination = interrupted ?? signal;
  const status = spawnFailed
    ? 1
    : termination
      ? 128 + (constants.signals[termination] ?? 1)
      : (code ?? 1);
  process.exitCode = status;
  if (status === 0) {
    const totals = { passed: 0, failed: 0, skipped: 0, cancelled: 0, todo: 0 };
    let hasTests = false;
    let steps = 0;
    let checkedFiles = 0;
    let hasCheckedFiles = false;
    let typecheckedFiles = 0;
    let warnings = 0;
    const testKeys = {
      pass: "passed",
      fail: "failed",
      skipped: "skipped",
      cancelled: "cancelled",
      todo: "todo",
    };
    if (log) {
      try {
        const lines = createInterface({
          input: createReadStream(log),
          crlfDelay: Infinity,
        });
        for await (const rawLine of lines) {
          const line = rawLine
            .replace(/\x1b\[[0-9;]*m/g, "")
            .replace(/^\S+ \S+: /, "");
          // Nested summaries already contain their own counts and timing.
          if (/^PASS /.test(line)) console.log(line);
          const node = line.match(
            /^(?:#|ℹ) (pass|fail|skipped|cancelled|todo) (\d+)$/,
          );
          if (node) {
            hasTests = true;
            totals[testKeys[node[1]]] += Number(node[2]);
          }
          const deno = line.match(
            /^ok \| (\d+) passed(?: \((\d+) steps?\))? \| (\d+) failed(?: \| (\d+) ignored)?/,
          );
          if (deno) {
            hasTests = true;
            totals.passed += Number(deno[1]);
            steps += Number(deno[2] ?? 0);
            totals.failed += Number(deno[3]);
            totals.skipped += Number(deno[4] ?? 0);
          }
          const files = line.match(/^Checked (\d+) files?\b/);
          if (files) {
            hasCheckedFiles = true;
            checkedFiles += Number(files[1]);
          }
          if (/^Check (?:file:|https?:)/.test(line)) typecheckedFiles++;
          const warning = line.match(/^Found (\d+) warnings?\./);
          if (warning) warnings += Number(warning[1]);
        }
      } catch (error) {
        process.exitCode = 1;
        console.error(`Could not read ${log}: ${error.message}`);
        return;
      }
    }
    const details = [];
    if (hasTests) {
      details.push(
        `${totals.passed} passed, ${totals.failed} failed, ${totals.skipped} skipped`,
      );
      if (steps) details.push(`${steps} steps`);
      if (totals.cancelled) details.push(`${totals.cancelled} cancelled`);
      if (totals.todo) details.push(`${totals.todo} todo`);
    }
    if (hasCheckedFiles) details.push(`${checkedFiles} files checked`);
    if (typecheckedFiles) details.push(`${typecheckedFiles} files typechecked`);
    if (warnings) details.push(`${warnings} warnings`);
    if (folder) rmSync(folder, { recursive: true, force: true });
    if (!verbose)
      console.log(
        `${summary}${details.length ? ` — ${details.join("; ")}` : ""} (${((performance.now() - started) / 1000).toFixed(2)}s)`,
      );
    return;
  }
  console.error(`FAIL ${label} (${termination ?? `exit ${status}`})`);
  if (!log) return;
  if (process.env.CI === "true" || process.env.CI === "1") {
    // CI logs must contain complete failure diagnostics after the worker exits.
    const stream = createReadStream(log);
    stream.pipe(process.stderr, { end: false });
    stream.on("end", () => console.error(`\nFull log: ${log}`));
    stream.on("error", (error) =>
      console.error(`Could not read ${log}: ${error.message}`),
    );
    return;
  }
  const size = statSync(log).size;
  const length = Math.min(size, 16384);
  const buffer = Buffer.alloc(length);
  const input = openSync(log, "r");
  try {
    readSync(input, buffer, 0, length, size - length);
  } finally {
    closeSync(input);
  }
  let lines = buffer.toString("utf8").split("\n");
  if (size > length) lines.shift(); // Drop any partial first line.
  const truncated = size > length || lines.length > 80;
  if (truncated)
    console.error(
      "Showing the end of the output; full diagnostics are in the log.",
    );
  process.stderr.write(lines.slice(-80).join("\n"));
  console.error(`\nFull log: ${log}`);
});
