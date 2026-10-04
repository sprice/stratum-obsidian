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

// Only use for finite checks. Interactive commands and data-producing commands
// must retain their stdout and stdin contracts.
const [command, ...args] = process.argv.slice(2);
if (!command) {
  console.error("Usage: run-quiet.mjs <command> [arguments...]");
  process.exit(1);
}
const label = process.env.npm_lifecycle_event ?? basename(command);
const verbose = process.env.STRATUM_VERBOSE === "1";
const folder = verbose ? null : mkdtempSync(join(tmpdir(), "stratum-check-"));
const log = folder && join(folder, "output.log");
const fd = log ? openSync(log, "w", 0o600) : null;
// pnpm's JS entry point avoids shell parsing and .cmd spawning on Windows.
const pnpmEntry = command === "pnpm" && process.env.npm_execpath;
const child = spawn(
  pnpmEntry ? process.execPath : command,
  pnpmEntry ? [pnpmEntry, ...args] : args,
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
child.once("close", (code, signal) => {
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
    if (folder) rmSync(folder, { recursive: true, force: true });
    if (!verbose) console.log(`PASS ${label}`);
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
