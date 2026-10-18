import { globSync, readdirSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { parse } from "yaml";

const testName = /(?:[._](?:test|spec))\.(?:[cm]?js|tsx?)$/;
const ignored = new Set([
  ".git",
  ".wireit",
  ".ci-cache",
  "node_modules",
  ".test-artifacts",
  "dist",
  ".next",
  ".vercel",
]);
export function testFiles(directory) {
  const files = [];
  function walk(current) {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (ignored.has(entry.name)) continue;
      const path = resolve(current, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile() && testName.test(entry.name)) files.push(path);
    }
  }
  walk(directory);
  return files.sort();
}

// Inspect commands; never execute workflow or manifest content.
export function coveredTests(workflow, cwd, packages = new Map()) {
  const covered = new Set();
  const active = new Set();
  function visitScript(name, directory) {
    const manifest = JSON.parse(
      readFileSync(resolve(directory, "package.json"), "utf8"),
    );
    const script = manifest.scripts?.[name];
    const config = manifest.wireit?.[name];
    if (!script && !config)
      throw new Error(`Unknown CI script ${name} in ${directory}`);
    const key = `${directory}:${name}`;
    if (active.has(key)) throw new Error(`Circular CI script: ${key}`);
    active.add(key);
    try {
      if (script === "wireit" || (!script && config)) {
        if (!config || typeof config !== "object")
          throw new Error(`Missing Wireit configuration: ${key}`);
        if (
          config.dependencies !== undefined &&
          !Array.isArray(config.dependencies)
        )
          throw new Error(`Unsupported Wireit dependencies: ${key}`);
        for (const dependency of config.dependencies ?? []) {
          const target =
            typeof dependency === "string" ? dependency : dependency?.script;
          // This guard supports package-local tasks only; never silently omit others.
          if (typeof target !== "string" || target.includes("/"))
            throw new Error(`Unsupported Wireit dependency: ${key}`);
          visitScript(target, directory);
        }
        if (config.command !== undefined) {
          if (typeof config.command !== "string")
            throw new Error(`Unsupported Wireit command: ${key}`);
          visit(config.command, directory);
        }
      } else {
        if (script.startsWith("wireit"))
          throw new Error(`Unsupported Wireit invocation: ${key}`);
        visit(script, directory);
      }
    } finally {
      active.delete(key);
    }
  }
  function visit(command, directory) {
    for (let part of command.split(/&&|\n/)) {
      part = part.trim();
      if (!part || part.startsWith("#")) continue;
      const quiet = /^node\s+\S*run-quiet\.mjs\s+/;
      part = part.replace(quiet, "");
      const tokens = part.split(/\s+/);
      if (tokens[0] === "pnpm") {
        let index = 1;
        let target = directory;
        while (tokens[index]?.startsWith("-")) {
          const option = tokens[index++];
          if (option === "--filter") {
            target = packages.get(tokens[index++]);
            if (!target)
              throw new Error(`Unknown package in CI command: ${part}`);
          } else if (option !== "--silent") {
            // Recursive typechecking is not a test runner.
            if (option === "-r") return;
            throw new Error(`Unsupported pnpm option in CI command: ${part}`);
          }
        }
        if (tokens[index] === "run") index++;
        const name = tokens[index];
        if (name === "install") continue;
        visitScript(name, target);
      } else if (tokens[0] === "node" && tokens.includes("--test")) {
        let index = tokens.indexOf("--test") + 1;
        for (; index < tokens.length; index++) {
          const token = tokens[index];
          if (["--import", "--require", "--test-reporter"].includes(token)) {
            index++;
            continue;
          }
          if (token.startsWith("-")) continue;
          for (const file of globSync(token, { cwd: directory })) {
            if (testName.test(file)) covered.add(resolve(directory, file));
          }
        }
      } else if (tokens[0] === "deno" && tokens[1] === "test") {
        for (let index = 2; index < tokens.length; index++) {
          const token = tokens[index];
          if (token === "--config") {
            index++;
            continue;
          }
          if (token.startsWith("-")) continue;
          for (const file of testFiles(resolve(directory, token)))
            covered.add(file);
        }
      }
    }
  }
  const document = parse(workflow);
  if (!document.jobs?.build?.steps) throw new Error("Missing CI build steps");
  for (const step of document.jobs.build.steps) {
    if (step.run)
      visit(step.run, resolve(cwd, step["working-directory"] ?? ""));
  }
  return covered;
}
export function missingTests(files, covered, root) {
  return files
    .filter((file) => !covered.has(file))
    .map((file) => relative(root, file));
}
