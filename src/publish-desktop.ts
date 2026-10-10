/* Desktop host access is loaded only after Platform.isDesktopApp is checked. */
import { Platform } from "obsidian";
import { readPublishOptions, type PublishOptions } from "./publish-options";
import { configureDocx } from "./publish-docx";
import { publicationFilter, publicationHeader } from "./publish-layout";
import type { PublishFormat } from "./publish-model";
import type { aastexManuscript } from "./publication-package";
export interface PublishAsset {
  name: string;
  bytes: ArrayBuffer;
}
interface PublishTools {
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
let fontDiscovery: Promise<string[]> | null = null;
/**
 * Discover font names on request and reuse them for the session; never upload font data.
 * Native discovery can take many seconds, so callers refresh only after a miss.
 */
export function installedPublishFonts(refresh = false): Promise<string[]> {
  if (refresh || !fontDiscovery) {
    const pending = discoverPublishFonts();
    fontDiscovery = pending;
    pending.catch(() => {
      if (fontDiscovery === pending) fontDiscovery = null;
    });
  }
  return fontDiscovery;
}
async function discoverPublishFonts(): Promise<string[]> {
  const local = host() as HostWindow & {
    queryLocalFonts?: () => Promise<{ family: string }[]>;
  };
  let families: string[] = [];
  if (local.queryLocalFonts) {
    try {
      families = (await local.queryLocalFonts()).map((font) => font.family);
    } catch {
      /* Native desktop discovery remains available. */
    }
  }
  if (!families.length) {
    const { process, path } = modules();
    if (process.platform === "darwin") {
      const output = await runPublishTool(
        "/usr/sbin/system_profiler",
        ["SPFontsDataType", "-json"],
        { timeout: 30_000, outputLimit: 8_000_000 },
      );
      const data = JSON.parse(output) as {
        SPFontsDataType?: {
          typefaces?: { family?: string; enabled?: string }[];
        }[];
      };
      families = (data.SPFontsDataType ?? []).flatMap((font) =>
        (font.typefaces ?? [])
          .filter((face) => face.enabled !== "no")
          .map((face) => face.family ?? ""),
      );
    } else if (process.platform === "win32") {
      const output = await runPublishTool(
        path.join(
          process.env.SystemRoot || "C:\\Windows",
          "System32",
          "WindowsPowerShell",
          "v1.0",
          "powershell.exe",
        ),
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          "Add-Type -AssemblyName System.Drawing; (New-Object System.Drawing.Text.InstalledFontCollection).Families | ForEach-Object { $_.Name }",
        ],
        { timeout: 15_000, outputLimit: 1_000_000 },
      );
      families = output.split(/\r?\n/);
    } else {
      families = (
        await runPublishTool("fc-list", ["--format=%{family}\\n"], {
          timeout: 15_000,
          outputLimit: 1_000_000,
        })
      )
        .split(/\r?\n/)
        .flatMap((name) => name.split(","));
    }
  }
  return [
    ...new Set(
      families
        .map((name) => name.trim())
        .filter((name) => name && name.length <= 120),
    ),
  ].sort((a, b) => a.localeCompare(b));
}
/** A selected font is unavailable to PDF typesetting; the tools themselves still work. */
export class PublishFontError extends Error {
  readonly fonts: string[];
  constructor(font: string | string[]) {
    const fonts = [...new Set(typeof font === "string" ? [font] : font)];
    super(
      `${fonts.map((name) => `“${name}”`).join(" and ")} ${fonts.length === 1 ? "isn’t" : "aren’t"} available on this computer. Choose another font to publish this PDF.`,
    );
    this.fonts = fonts;
  }
}
/** No shell, bounded output, cancellable, and no note content in logs. */
export function runPublishTool(
  executable: string,
  args: string[],
  options: {
    cwd?: string;
    timeout?: number;
    signal?: AbortSignal;
    outputLimit?: number;
  } = {},
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
      output = (output + chunk.toString()).slice(
        -(options.outputLimit ?? 32768),
      );
    });
    task.stderr.on("data", (chunk: { toString(): string }) => {
      error = (error + chunk.toString()).slice(-(options.outputLimit ?? 32768));
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
  layout?: PublishOptions,
  aastex?: {
    manuscript: ReturnType<typeof aastexManuscript>;
    abstractHtml: string;
    references: import("./csl-data").CslItem[];
  },
): Promise<ArrayBuffer> {
  if (format === "pdf" && aastex)
    return convertAastexPublication(
      html,
      assets,
      tools,
      aastex,
      signal,
      timeout,
    );
  const options = layout ? readPublishOptions(layout) : undefined;
  if (format === "pdf" && options) {
    const selected = [...new Set([options.bodyFont, options.titleFont])].filter(
      Boolean,
    );
    if (selected.length) {
      // If discovery fails, let the PDF engine perform its authoritative check.
      const missing = async (refresh: boolean) => {
        const installed = await installedPublishFonts(refresh).catch(
          () => null,
        );
        const available = new Set(installed?.map((font) => font.toLowerCase()));
        return installed
          ? selected.filter((font) => !available.has(font.toLowerCase()))
          : [];
      };
      // A cached list can predate a newly installed font; check again before failing.
      if ((await missing(false)).length) {
        const unavailable = await missing(true);
        if (unavailable.length) throw new PublishFontError(unavailable);
      }
    }
  }
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
      "--from=html+epub_html_exts+tex_math_single_backslash",
      "--standalone",
      "--resource-path=.",
      "--output",
      output,
    ];
    args.push("--log=diagnostics.json");
    if (options) {
      await fs.writeFile(
        path.join(directory, "layout.lua"),
        publicationFilter(options),
        { mode: 0o600 },
      );
      args.push("--lua-filter=layout.lua");
      if (options.numberSections) args.push("--number-sections");
    }
    if (format === "pdf")
      args.push(
        `--pdf-engine=${tools.tectonic}`,
        `--variable=geometry:margin=${options?.margin ?? 1}in`,
      );
    if (format === "pdf" && options) {
      await fs.writeFile(
        path.join(directory, "layout.tex"),
        publicationHeader(options),
        { mode: 0o600 },
      );
      // Tectonic uses XeTeX/fontspec; choose fonts explicitly for text, not math.
      args.push(
        ...(options.bodyFont
          ? [
              `--variable=mainfont:${options.bodyFont}`,
              `--variable=sansfont:${options.bodyFont}`,
            ]
          : []),
        "--variable=fontsize:12pt",
        `--variable=papersize:${options.paperSize}`,
        `--variable=linestretch:${options.lineSpacing}`,
        "--include-in-header=layout.tex",
      );
    }
    args.push("document.html");
    try {
      await runPublishTool(tools.pandoc, args, {
        cwd: directory,
        signal,
        timeout,
      });
    } catch (error) {
      const font =
        format === "pdf" && error instanceof Error
          ? /fontspec Error: The font "([^"]+)"\s*(?:\(fontspec\)\s*)?cannot be found/.exec(
              error.message,
            )?.[1]
          : undefined;
      if (font) throw new PublishFontError(font);
      throw error;
    }
    if (signal?.aborted) throw new Error("Publishing cancelled.");
    // Inspect warning categories, not localized stderr or a blanket warning exit status.
    // The private temporary diagnostics file is removed with the conversion directory.
    const diagnostics: unknown = JSON.parse(
      new TextDecoder().decode(
        await fs.readFile(path.join(directory, "diagnostics.json")),
      ),
    );
    if (!Array.isArray(diagnostics))
      throw new Error(
        "The publishing tool's conversion diagnostics could not be read.",
      );
    if (
      diagnostics.some(
        (entry: unknown) =>
          entry !== null &&
          typeof entry === "object" &&
          "type" in entry &&
          entry.type === "CouldNotConvertTeXMath",
      )
    )
      throw new Error(
        `An equation could not be converted to ${format === "docx" ? "Word" : "PDF"}. Simplify the equation${format === "docx" ? ", or publish to PDF" : ""}, then try again.`,
      );
    const bytes = await fs.readFile(path.join(directory, output));
    if (
      format === "pdf"
        ? new TextDecoder().decode(bytes.subarray(0, 5)) !== "%PDF-"
        : bytes[0] !== 0x50 || bytes[1] !== 0x4b
    )
      throw new Error("The converter did not produce a valid document.");
    const configured =
      format === "docx" && options
        ? configureDocx(bytes, options, (data) =>
            (
              host().require!("node:zlib") as {
                inflateRawSync(data: Uint8Array): Uint8Array;
              }
            ).inflateRawSync(data),
          )
        : bytes;
    return Uint8Array.from(configured).buffer;
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

export const aastexFilter = `
function Span(el)
  -- The HTML reader removes the data- prefix from custom attributes.
  if el.classes:includes('stratum-aastex-citation') then
    local tex = el.attributes['tex'] or el.attributes['data-tex']
    if not tex then error('An AASTeX citation lost its structured data during conversion.') end
    return pandoc.RawInline('latex', tex)
  end
end
local function latex(blocks)
  return (pandoc.write(pandoc.Pandoc(blocks), 'latex'):gsub('\\n+$', ''))
end
function Table(el)
  local cols = #el.colspecs
  local alignments = {}
  local function alignment(value)
    if value == pandoc.AlignRight then return 'r' end
    if value == pandoc.AlignCenter then return 'c' end
    return 'l'
  end
  for _, spec in ipairs(el.colspecs) do table.insert(alignments, alignment(spec[1])) end
  local rows = {}
  local function add(row)
    local cells = {}
    for index, cell in ipairs(row.cells) do
      if cell.col_span ~= 1 or cell.row_span ~= 1 then error('Merged table cells are not supported by the AASTeX template yet.') end
      local content = latex(cell.contents)
      if cell.alignment ~= pandoc.AlignDefault and alignment(cell.alignment) ~= alignments[index] then
        content = '\\\\multicolumn{1}{' .. alignment(cell.alignment) .. '}{' .. content .. '}'
      end
      table.insert(cells, content)
    end
    table.insert(rows, table.concat(cells, ' & ') .. ' \\\\\\\\')
  end
  for _, row in ipairs(el.head.rows) do add(row) end
  for _, body in ipairs(el.bodies) do
    for _, row in ipairs(body.head) do add(row) end
    for _, row in ipairs(body.body) do add(row) end
  end
  for _, row in ipairs(el.foot.rows) do add(row) end
  local caption = ''
  if #el.caption.long > 0 then
    caption = '\\\\caption{' .. latex(el.caption.long) .. '}\\n'
  elseif el.caption.short then
    caption = '\\\\caption{' .. latex({pandoc.Plain(el.caption.short)}) .. '}\\n'
  end
  if #alignments ~= cols then error('The AASTeX table has inconsistent column definitions.') end
  return pandoc.RawBlock('latex', '\\\\begin{table}[ht]\\n\\\\centering\\n' .. caption .. '\\\\begin{tabular}{' .. table.concat(alignments) .. '}\\n\\\\hline\\n' .. table.concat(rows, '\\n') .. '\\n\\\\hline\\n\\\\end{tabular}\\n\\\\end{table}')
end
`;

interface BibliographyResponse {
  statusCode?: number;
  destroy(): void;
  on(event: "data", listener: (bytes: Uint8Array) => void): void;
  on(event: "error", listener: (error: Error) => void): void;
  on(event: "end", listener: () => void): void;
}
interface BibliographyRequest {
  destroy(error?: Error): void;
  on(event: "close", listener: () => void): void;
  on(event: "error", listener: (error: Error) => void): void;
}
interface BibliographyHttps {
  get(
    url: string,
    options: { signal?: AbortSignal; headers: Record<string, string> },
    callback: (response: BibliographyResponse) => void,
  ): BibliographyRequest;
}
interface BibliographyCrypto {
  createHash(algorithm: "sha256"): {
    update(bytes: Uint8Array): { digest(encoding: "hex"): string };
  };
}

/** Fetch directly from AAS for this export only; never retain a reusable copy. */
export async function downloadAastexBibliography(
  specification: { url: string; sha256: string },
  signal?: AbortSignal,
  timeout = 30_000,
): Promise<Uint8Array> {
  if (!Platform.isDesktop)
    throw new Error("PDF publishing requires desktop Obsidian.");
  const require = host().require;
  if (!require) throw new Error("Desktop network access is unavailable.");
  const https = require("node:https") as BibliographyHttps;
  const crypto = require("node:crypto") as BibliographyCrypto;
  const { Buffer } = require("node:buffer") as {
    Buffer: { concat(chunks: Uint8Array[]): Uint8Array };
  };
  if (signal?.aborted) throw new Error("Publishing cancelled.");
  return new Promise((resolve, reject) => {
    const request = https.get(
      specification.url,
      {
        signal,
        headers: {
          "Cache-Control": "no-store",
          "User-Agent": "Stratum-Obsidian (AASTeX publishing)",
        },
      },
      (response) => {
        if (response.statusCode !== 200) {
          response.destroy();
          reject(
            new Error(
              `AAS could not supply the bibliography style (HTTP ${response.statusCode ?? "unknown"}). Try publishing again later.`,
            ),
          );
          return;
        }
        const chunks: Uint8Array[] = [];
        let length = 0;
        response.on("data", (chunk: Uint8Array) => {
          length += chunk.length;
          if (length > 1_000_000)
            request.destroy(
              new Error("The AAS bibliography download is too large."),
            );
          else chunks.push(chunk);
        });
        response.on("error", reject);
        response.on("end", () => {
          if (signal?.aborted) {
            reject(new Error("Publishing cancelled."));
            return;
          }
          const bytes = Buffer.concat(chunks);
          if (
            crypto.createHash("sha256").update(bytes).digest("hex") !==
            specification.sha256
          ) {
            reject(
              new Error(
                "The AAS bibliography style changed. Update Stratum before publishing this PDF.",
              ),
            );
            return;
          }
          resolve(Uint8Array.from(bytes));
        });
      },
    );
    const timer = window.setTimeout(
      () =>
        request.destroy(
          new Error("Downloading the AAS bibliography style timed out."),
        ),
      timeout,
    );
    request.on("close", () => window.clearTimeout(timer));
    request.on("error", (error) =>
      reject(
        new Error(
          signal?.aborted
            ? "Publishing cancelled."
            : `Could not download the AAS bibliography style. Check your internet connection and try again. ${error.message}`,
        ),
      ),
    );
  });
}
async function convertAastexPublication(
  html: string,
  assets: PublishAsset[],
  tools: PublishTools,
  input: {
    manuscript: ReturnType<typeof aastexManuscript>;
    abstractHtml: string;
    references: import("./csl-data").CslItem[];
  },
  signal?: AbortSignal,
  timeout = 120_000,
): Promise<ArrayBuffer> {
  const { fs, path, os } = modules();
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "stratum-aastex-"));
  try {
    const { aastexPackage: pkg, aastexLatex } =
      await import("./publication-package");
    for (const relative of [pkg.manifest.class])
      await fs.writeFile(
        path.join(directory, path.basename(relative)),
        pkg.files[relative],
        { mode: 0o600 },
      );
    if (input.references.length) {
      const bibliography = await downloadAastexBibliography(
        pkg.manifest.bibliographyDownload,
        signal,
        Math.min(timeout, 30_000),
      );
      await fs.writeFile(
        path.join(directory, path.basename(pkg.manifest.bibliographyStyle)),
        bibliography,
        { mode: 0o600 },
      );
    }
    await fs.writeFile(path.join(directory, "aastex.lua"), aastexFilter, {
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
    for (const [name, content] of [
      ["body", html],
      ["abstract", input.abstractHtml],
    ]) {
      await fs.writeFile(path.join(directory, `${name}.html`), content, {
        mode: 0o600,
      });
      await runPublishTool(
        tools.pandoc,
        [
          `${name}.html`,
          "--from=html+epub_html_exts+tex_math_single_backslash",
          "--to=latex",
          "--lua-filter=aastex.lua",
          "--resource-path=.",
          "--output",
          `${name}.tex`,
        ],
        { cwd: directory, signal, timeout },
      );
    }
    if (input.references.length) {
      await fs.writeFile(
        path.join(directory, "references.json"),
        JSON.stringify(input.references),
        { mode: 0o600 },
      );
      await runPublishTool(
        tools.pandoc,
        [
          "references.json",
          "--from=csljson",
          "--to=bibtex",
          "--output",
          "references.bib",
        ],
        { cwd: directory, signal, timeout },
      );
    }
    const decode = async (name: string) =>
      new TextDecoder().decode(await fs.readFile(path.join(directory, name)));
    const tex = aastexLatex(
      input.manuscript,
      await decode("body.tex"),
      await decode("abstract.tex"),
      !!input.references.length,
    );
    await fs.writeFile(path.join(directory, "document.tex"), tex, {
      mode: 0o600,
    });
    await runPublishTool(tools.tectonic, ["--keep-logs", "document.tex"], {
      cwd: directory,
      signal,
      timeout,
    });
    if (signal?.aborted) throw new Error("Publishing cancelled.");
    const log = await decode("document.log");
    if (
      /Citation .* undefined|There were undefined (?:references|citations)|No file .*\.bbl/.test(
        log,
      )
    )
      throw new Error(
        "AASTeX could not resolve the manuscript bibliography. Review citation data and try again.",
      );
    const bytes = await fs.readFile(path.join(directory, "document.pdf"));

    if (new TextDecoder().decode(bytes.subarray(0, 5)) !== "%PDF-")
      throw new Error("AASTeX did not produce a valid PDF.");
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
  const pixel = new Uint8Array([
    137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0,
    0, 0, 1, 8, 2, 0, 0, 0, 144, 119, 83, 222, 0, 0, 0, 12, 73, 68, 65, 84, 120,
    156, 99, 248, 255, 255, 63, 0, 5, 254, 2, 254, 13, 239, 70, 184, 0, 0, 0, 0,
    73, 69, 78, 68, 174, 66, 96, 130,
  ]).buffer;
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
