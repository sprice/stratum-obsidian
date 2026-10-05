/* Desktop host access is loaded only after Platform.isDesktopApp is checked. */
import { Platform } from "obsidian";
import type { PublishFormat } from "./publish-model";
export interface PublishAsset {
  name: string;
  bytes: ArrayBuffer;
}
export interface PublishTools {
  pandoc: string;
  tectonic: string;
}
export interface ToolStatus {
  path: string;
  version: string;
  error?: string;
  foundPath?: string;
}
export interface PublishReadiness {
  pandoc: ToolStatus;
  tectonic: ToolStatus;
  word: boolean;
  pdf: boolean;
  wordError?: string;
  pdfError?: string;
}
type HostWindow = Window & {
  require?: (name: string) => unknown;
  electron?: {
    remote?: {
      dialog?: {
        showSaveDialog(options: {
          defaultPath: string;
          filters: { name: string; extensions: string[] }[];
          properties: string[];
        }): Promise<{ canceled: boolean; filePath?: string }>;
        showOpenDialog(options: {
          title: string;
          properties: string[];
        }): Promise<{ canceled: boolean; filePaths: string[] }>;
      };
      shell?: { openPath(path: string): Promise<string> };
    };
  };
};
function host(): HostWindow {
  if (!Platform.isDesktopApp)
    throw new Error("Publishing is available in the desktop app.");
  return window;
}
interface DesktopFiles {
  mkdtemp(prefix: string): Promise<string>;
  writeFile(
    path: string,
    data: string | Uint8Array,
    options?: { mode: number },
  ): Promise<void>;
  readFile(path: string): Promise<Uint8Array>;
  rm(
    path: string,
    options: { recursive: boolean; force: boolean },
  ): Promise<void>;
  realpath(path: string): Promise<string>;
  lstat(path: string): Promise<{ isSymbolicLink(): boolean }>;
}
interface DesktopPath {
  join(...parts: string[]): string;
  dirname(path: string): string;
  basename(path: string): string;
  relative(from: string, to: string): string;
  isAbsolute(path: string): boolean;
  sep: string;
}
interface DesktopProcess {
  platform: string;
  arch: string;
  env: Record<string, string | undefined>;
  kill(pid: number, signal: string): void;
}
interface ChildTask {
  pid?: number;
  kill(): boolean;
  stdout: {
    on(event: "data", listener: (chunk: { toString(): string }) => void): void;
  };
  stderr: {
    on(event: "data", listener: (chunk: { toString(): string }) => void): void;
  };
  on(event: "error", listener: (error: Error) => void): void;
  once(event: "error", listener: (error: Error) => void): void;
  once(event: "close", listener: (code: number | null) => void): void;
}
interface DesktopChild {
  spawn(
    executable: string,
    args: string[],
    options: {
      cwd?: string;
      shell: false;
      windowsHide: boolean;
      detached?: boolean;
      stdio: string | string[];
    },
  ): ChildTask;
}
function modules() {
  if (!Platform.isDesktop)
    throw new Error("Publishing requires the desktop app.");
  const require = host().require;
  if (!require)
    throw new Error(
      "Desktop file access is unavailable. Restart Obsidian and try again.",
    );
  return {
    fs: require("node:fs/promises") as DesktopFiles,
    path: require("node:path") as DesktopPath,
    os: require("node:os") as { homedir(): string; tmpdir(): string },
    process: require("node:process") as DesktopProcess,
    child: require("node:child_process") as DesktopChild,
  };
}
export function publishPlatform(): {
  platform: string;
  arch: string;
  homebrew: boolean;
} {
  const { process } = modules();
  return {
    platform: process.platform,
    arch: process.arch,
    homebrew: process.platform === "darwin",
  };
}
/** No shell, bounded output, cancellable, and no note content in logs. */
export function runPublishTool(
  executable: string,
  args: string[],
  options: { cwd?: string; timeout?: number; signal?: AbortSignal } = {},
): Promise<string> {
  const { child, process, path } = modules();
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(new Error("Publishing cancelled."));
      return;
    }
    const task = child.spawn(executable, args, {
      cwd: options.cwd,
      shell: false,
      windowsHide: true,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "",
      error = "",
      failure: Error | null = null;
    let killTimer: number | null = null;
    const killTree = (force: boolean) => {
      if (!task.pid) return;
      if (process.platform === "win32") {
        const killer = child.spawn(
          path.join(
            process.env.SystemRoot || "C:\\Windows",
            "System32",
            "taskkill.exe",
          ),
          ["/PID", String(task.pid), "/T", "/F"],
          { shell: false, windowsHide: true, stdio: "ignore" },
        );
        killer.on("error", () => task.kill());
      } else {
        try {
          process.kill(-task.pid, force ? "SIGKILL" : "SIGTERM");
        } catch {
          task.kill();
        }
      }
    };
    const stop = (message: string) => {
      if (failure) return;
      failure = new Error(message);
      killTree(false);
      killTimer = window.setTimeout(() => killTree(true), 1500);
    };
    const abort = () => stop("Publishing cancelled.");
    options.signal?.addEventListener("abort", abort, { once: true });
    const timer = window.setTimeout(
      () =>
        stop(
          "The conversion timed out. Check your connection if PDF support files are still downloading, then try again.",
        ),
      options.timeout ?? 120_000,
    );
    const cleanup = () => {
      window.clearTimeout(timer);
      if (killTimer !== null) window.clearTimeout(killTimer);
      options.signal?.removeEventListener("abort", abort);
    };
    task.stdout.on("data", (chunk: { toString(): string }) => {
      output = (output + chunk.toString()).slice(-32768);
    });
    task.stderr.on("data", (chunk: { toString(): string }) => {
      error = (error + chunk.toString()).slice(-32768);
    });
    task.once("error", (reason) => {
      cleanup();
      reject(
        new Error(`Could not start the publishing tool: ${reason.message}`),
      );
    });
    task.once("close", (code) => {
      // The parent can close its pipes before a child finishes handling SIGTERM.
      // Do not clear the escalation timer while leaving that child alive.
      if (failure && process.platform !== "win32") killTree(true);
      cleanup();
      if (failure) reject(failure);
      else if (code !== 0)
        reject(
          new Error(
            error.trim() || `The publishing tool exited with code ${code}.`,
          ),
        );
      else resolve(output);
    });
  });
}
export async function detectPublishTool(
  name: "pandoc" | "tectonic",
  configured: string,
  signal?: AbortSignal,
): Promise<ToolStatus> {
  const { fs, os, path, process } = modules();
  const home = os.homedir();
  const windows = process.platform === "win32";
  const executable = windows ? `${name}.exe` : name;
  const searchPath = process.env.PATH ?? process.env.Path ?? "";
  const directories = [
    ...searchPath
      .split(windows ? ";" : ":")
      .filter((dir) => path.isAbsolute(dir)),
    ...(windows
      ? [process.env.LOCALAPPDATA, process.env.ProgramFiles]
          .filter((dir): dir is string => !!dir)
          .map((dir) =>
            path.join(dir, name === "pandoc" ? "Pandoc" : "Tectonic"),
          )
      : [
          "/opt/homebrew/bin",
          "/usr/local/bin",
          "/usr/bin",
          "/opt/local/bin",
          path.join(home, ".local", "bin"),
          path.join(home, ".cargo", "bin"),
          `/opt/homebrew/opt/${name}/bin`,
          `/usr/local/opt/${name}/bin`,
        ]),
  ];
  const override = configured.trim().replace(/^~[/\\]/, `${home}${path.sep}`);
  const candidates = [
    ...new Set(
      override && override !== name && override !== executable
        ? [override]
        : directories.map((dir) => path.join(dir, executable)),
    ),
  ];
  let failure: ToolStatus | undefined;
  for (const candidate of candidates) {
    if (signal?.aborted) throw new Error("Setup cancelled.");
    let absolute: string;
    try {
      absolute = await fs.realpath(candidate);
    } catch (error) {
      if (override)
        failure = {
          path: "",
          version: "",
          error: `Could not start the publishing tool: ${error instanceof Error ? error.message : "File not found."}`,
        };
      continue;
    }
    try {
      const version = (
        await runPublishTool(absolute, ["--version"], {
          timeout: 8_000,
          signal,
        })
      )
        .split("\n")[0]
        .trim();
      if (!version.toLowerCase().includes(name))
        throw new Error(`Choose the ${name} executable.`);
      return { path: absolute, version };
    } catch (reason) {
      failure ??= {
        path: "",
        version: "",
        foundPath: absolute,
        error:
          reason instanceof Error
            ? reason.message
            : "The installed tool could not run.",
      };
    }
  }
  if (signal?.aborted) throw new Error("Setup cancelled.");
  return (
    failure ?? {
      path: "",
      version: "",
      error:
        "Not found. Install the tool, then check again, or choose its location in advanced settings.",
    }
  );
}

export async function convertPublication(
  html: string,
  assets: PublishAsset[],
  format: PublishFormat,
  tools: PublishTools,
  signal?: AbortSignal,
  timeout = 120_000,
): Promise<ArrayBuffer> {
  const { fs, path, os } = modules();
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "stratum-publish-"),
  );
  try {
    await fs.writeFile(path.join(directory, "document.html"), html, {
      mode: 0o600,
    });
    for (const asset of assets) {
      if (!/^asset-\d+\.(png|jpg|jpeg|gif|svg|webp)$/i.test(asset.name))
        throw new Error("Invalid publication image name.");
      await fs.writeFile(
        path.join(directory, asset.name),
        new Uint8Array(asset.bytes),
        { mode: 0o600 },
      );
    }
    const output = `document.${format}`;
    const args = [
      "--from=html+epub_html_exts",
      "--standalone",
      "--resource-path=.",
      "--output",
      output,
    ];
    if (format === "pdf")
      args.push(
        `--pdf-engine=${tools.tectonic}`,
        "--variable=geometry:margin=1in",
      );
    args.push("document.html");
    await runPublishTool(tools.pandoc, args, {
      cwd: directory,
      signal,
      timeout,
    });
    if (signal?.aborted) throw new Error("Publishing cancelled.");
    const bytes = await fs.readFile(path.join(directory, output));
    if (
      format === "pdf"
        ? new TextDecoder().decode(bytes.subarray(0, 5)) !== "%PDF-"
        : bytes[0] !== 0x50 || bytes[1] !== 0x4b
    )
      throw new Error("The converter did not produce a valid document.");
    return Uint8Array.from(bytes).buffer;
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}
const probeHtml =
  '<html xmlns:epub="http://www.idpf.org/2007/ops"><head><meta charset="utf-8"><title>Publishing check</title></head><body><h1>Publishing check</h1><p>A <em>formatted</em> citation (Example, 2024)<a epub:type="noteref" href="#n">1</a>.</p><table><tr><th>Example</th></tr><tr><td>Value</td></tr></table><p><img src="asset-0.png" alt="Test image"></p><aside epub:type="footnote" id="n"><p>Example footnote.</p></aside><h2>References</h2><div class="csl-bib-body hanging-indent"><div id="ref-stratum-setup" class="csl-entry">Example, A. (2024). <i>Synthetic reference.</i></div></div></body></html>';
/** Diagnose conversion support with synthetic content, never the failed note. */
export async function probePublication(
  format: PublishFormat,
  tools: PublishTools,
  signal?: AbortSignal,
  timeout = 120_000,
): Promise<void> {
  // One synthetic pixel; never use the user's note for setup checks.
  const pixel = Uint8Array.from(
    atob(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC",
    ),
    (c) => c.charCodeAt(0),
  ).buffer;
  await convertPublication(
    probeHtml,
    [{ name: "asset-0.png", bytes: pixel }],
    format,
    tools,
    signal,
    timeout,
  );
}
export async function checkPublishing(
  pandocPath: string,
  tectonicPath: string,
  preparePdf: boolean,
  signal?: AbortSignal,
  progress?: (text: string) => void,
  report?: (readiness: PublishReadiness) => void,
): Promise<PublishReadiness> {
  progress?.("Looking for publishing tools…");
  const [pandoc, tectonic] = await Promise.all([
    detectPublishTool("pandoc", pandocPath, signal),
    detectPublishTool("tectonic", tectonicPath, signal),
  ]);
  const readiness: PublishReadiness = {
    pandoc,
    tectonic,
    word: false,
    pdf: false,
  };
  report?.({ ...readiness });
  if (!pandoc.path) return readiness;
  const tools = { pandoc: pandoc.path, tectonic: tectonic.path };
  progress?.("Checking Word conversion…");
  try {
    await probePublication("docx", tools, signal);
    readiness.word = true;
  } catch (error) {
    readiness.wordError =
      error instanceof Error ? error.message : "Word conversion failed.";
  }
  if (signal?.aborted) throw new Error("Setup cancelled.");
  report?.({ ...readiness });
  if (preparePdf && tectonic.path) {
    progress?.(
      "Preparing PDF support. The first check may download support files and take several minutes…",
    );
    try {
      await probePublication("pdf", tools, signal, 600_000);
      readiness.pdf = true;
    } catch (error) {
      readiness.pdfError =
        error instanceof Error ? error.message : "PDF conversion failed.";
    }
  }
  if (signal?.aborted) throw new Error("Setup cancelled.");
  report?.({ ...readiness });
  return readiness;
}
export async function choosePublishExecutable(
  name: string,
): Promise<string | null> {
  const dialog = host().electron?.remote?.dialog;
  if (!dialog)
    throw new Error(
      "The native file dialog is unavailable in this Obsidian version. Enter the executable path in advanced setup.",
    );
  const result = await dialog.showOpenDialog({
    title: `Choose ${name} executable`,
    properties: ["openFile"],
  });
  return result.canceled ? null : (result.filePaths[0] ?? null);
}
export async function openPublishedFile(path: string): Promise<void> {
  const shell = host().electron?.remote?.shell;
  if (!shell)
    throw new Error("Opening files is unavailable in this Obsidian version.");
  const error = await shell.openPath(path);
  if (error) throw new Error(error);
}
export async function savePublishedCopy(
  bytes: ArrayBuffer,
  filename: string,
  format: PublishFormat,
  protectedDirectory: string,
): Promise<boolean> {
  const dialog = host().electron?.remote?.dialog;
  if (!dialog)
    throw new Error(
      "The native save dialog is unavailable in this Obsidian version.",
    );
  const result = await dialog.showSaveDialog({
    defaultPath: filename,
    filters: [
      {
        name: format === "pdf" ? "PDF document" : "Word document",
        extensions: [format],
      },
    ],
    properties: ["showOverwriteConfirmation"],
  });
  if (result.canceled || !result.filePath) return false;
  const { fs, path } = modules();
  const destination = result.filePath;
  const realParent = await fs.realpath(path.dirname(destination));
  const realProtected = await fs.realpath(protectedDirectory);
  const relative = path.relative(
    realProtected,
    path.join(realParent, path.basename(destination)),
  );
  if (
    !relative ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  )
    throw new Error(
      "Choose a location outside Stratum's published document storage.",
    );
  // Replacing a symlink must never overwrite its target.
  try {
    if ((await fs.lstat(destination)).isSymbolicLink())
      throw new Error(
        "Choose a regular file destination instead of a symbolic link.",
      );
  } catch (error) {
    if ((error as { code?: string }).code !== "ENOENT") throw error;
  }
  await fs.writeFile(destination, new Uint8Array(bytes));
  return true;
}
