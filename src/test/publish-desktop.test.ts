import { testPublishingWorkspace } from "./publishing-workspace";
import test from "node:test";
import { createHash } from "node:crypto";
import { setTimeout as schedule } from "node:timers";
import { EventEmitter } from "node:events";
import { posix } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import {
  access,
  mkdtemp,
  writeFile,
  readFile,
  rm,
  mkdir,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { loadRuntime } from "./runtime-harness";
import type * as Desktop from "../publish-desktop";
import { preparePublication } from "../publish-document";
import { formatCitationDocument } from "../citation-format";
import assets from "../csl/assets.json";
import {
  DEFAULT_ACADEMIC_OPTIONS,
  DEFAULT_PUBLISH_OPTIONS,
} from "../publish-options";
import { preparePublishMath } from "../publish-math";
const require = createRequire(import.meta.url);
function runtime(
  desktop = true,
  remote?: object,
  modules: Record<string, unknown> = {},
  globals: Record<string, unknown> = {},
) {
  return loadRuntime<typeof Desktop>(
    "publish-desktop.ts",
    { Platform: { isDesktopApp: desktop, isDesktop: desktop } },
    {
      ...globals,
      TextDecoder,
      TextEncoder,
      Uint8Array,
      window: {
        require: (name: string): unknown => modules[name] ?? require(name),
        electron: { remote },
        setTimeout,
        clearTimeout,
      },
    },
    "browser",
  );
}
function installedTool(name: string, configured?: string): string {
  for (const candidate of [
    configured,
    name,
    `/opt/homebrew/bin/${name}`,
    `/usr/local/bin/${name}`,
  ]) {
    if (!candidate) continue;
    try {
      execFileSync(candidate, ["--version"], { stdio: "ignore" });
      return candidate;
    } catch {
      /* Try the next installed location. */
    }
  }
  return "";
}
const pandoc = installedTool("pandoc", process.env.STRATUM_TEST_PANDOC);
const hasPandoc = !!pandoc;
const tectonic = installedTool("tectonic", process.env.STRATUM_TEST_TECTONIC);

test(
  "real PDF export accepts default fonts, academic opening, math and chemistry",
  { skip: !pandoc || !tectonic },
  async () => {
    const math = preparePublishMath(
      String.raw`$$\int_0^1 x^2\,\mathrm{d}x = \frac{1}{3}$$

Inline water: $\ce{H2O}$.

$$\ce{[AgCl2]-}$$

$$\ce{$A$ ->[\ce{+H2O}] $B$}$$

$$\ce{SO4^2- + Ba^2+ -> BaSO4 v}$$`,
    );
    const html = `<html><head><title>Unwanted metadata title</title></head><body><div class="stratum-publish-title"><p>Synthetic mathematical paper</p></div><div class="stratum-publish-abstract"><h2 class="unnumbered">Abstract</h2><p>A synthetic abstract.</p></div><h2>Introduction</h2><p>${math.restore(math.markdown)}</p></body></html>`;
    const bytes = await runtime().convertPublication(
      html,
      [],
      "pdf",
      { workspace: testPublishingWorkspace(), pandoc, tectonic },
      undefined,
      120_000,
      {
        ...DEFAULT_PUBLISH_OPTIONS,
        bodySize: 11.5,
        bodyFont: "",
        titleFont: "",
      },
    );
    assert.equal(
      new TextDecoder().decode(new Uint8Array(bytes).subarray(0, 5)),
      "%PDF-",
    );
  },
);

test(
  "real PDF export reports an unavailable selected font",
  { skip: !pandoc || !tectonic },
  async () => {
    await assert.rejects(
      runtime().convertPublication(
        "<html><body><p>Synthetic text.</p></body></html>",
        [],
        "pdf",
        { workspace: testPublishingWorkspace(), pandoc, tectonic },
        undefined,
        120_000,
        { ...DEFAULT_PUBLISH_OPTIONS, bodyFont: "Synthetic Missing Font" },
      ),
      /“Synthetic Missing Font” isn’t available on this computer/,
    );
  },
);

test("PDF font preflight reports both missing fonts before starting conversion", async () => {
  const desktop = loadRuntime<typeof Desktop>(
    "publish-desktop.ts",
    { Platform: { isDesktopApp: true, isDesktop: true } },
    {
      window: {
        queryLocalFonts: () => Promise.resolve([{ family: "Example Serif" }]),
        require: () => {
          throw new Error("Conversion must not start");
        },
      },
    },
  );
  await assert.rejects(
    desktop.convertPublication(
      "",
      [],
      "pdf",
      { workspace: testPublishingWorkspace(), pandoc: "", tectonic: "" },
      undefined,
      1000,
      {
        ...DEFAULT_PUBLISH_OPTIONS,
        bodyFont: "Missing body",
        titleFont: "Missing title",
      },
    ),
    (error: unknown) => {
      assert.ok(error instanceof desktop.PublishFontError);
      assert.deepEqual(Array.from(error.fonts), [
        "Missing body",
        "Missing title",
      ]);
      assert.match(error.message, /aren’t available/);
      return true;
    },
  );
});

test("installed font enumeration uses family names and does not run desktop processes when local access works", async () => {
  const desktop = loadRuntime<typeof Desktop>(
    "publish-desktop.ts",
    { Platform: { isDesktopApp: true, isDesktop: true } },
    {
      window: {
        queryLocalFonts: () =>
          Promise.resolve([
            { family: "Example Serif" },
            { family: "Example Serif" },
            { family: "Example Sans" },
          ]),
      },
    },
  );
  assert.deepEqual(Array.from(await desktop.installedPublishFonts()), [
    "Example Sans",
    "Example Serif",
  ]);
});

test("font discovery is cached for the session and refreshed once when a selected font is missing", async () => {
  let discoveries = 0;
  let families = [{ family: "Example Serif" }];
  const desktop = loadRuntime<typeof Desktop>(
    "publish-desktop.ts",
    { Platform: { isDesktopApp: true, isDesktop: true } },
    {
      window: {
        queryLocalFonts: () => {
          discoveries++;
          return Promise.resolve(families);
        },
        require: () => {
          throw new Error("Conversion reached");
        },
      },
    },
  );
  await desktop.installedPublishFonts();
  await desktop.installedPublishFonts();
  assert.equal(discoveries, 1);
  // A font installed after the first discovery is found by one refresh.
  families = [...families, { family: "New Serif" }];
  await assert.rejects(
    desktop.convertPublication(
      "",
      [],
      "pdf",
      { workspace: testPublishingWorkspace(), pandoc: "", tectonic: "" },
      undefined,
      1000,
      { ...DEFAULT_PUBLISH_OPTIONS, bodyFont: "New Serif" },
    ),
    /Conversion reached/,
  );
  assert.equal(discoveries, 2);
  // A cached hit does not run discovery again.
  await assert.rejects(
    desktop.convertPublication(
      "",
      [],
      "pdf",
      { workspace: testPublishingWorkspace(), pandoc: "", tectonic: "" },
      undefined,
      1000,
      { ...DEFAULT_PUBLISH_OPTIONS, bodyFont: "Example Serif" },
    ),
    /Conversion reached/,
  );
  assert.equal(discoveries, 2);
});

test("mobile cannot load or execute desktop dependencies", () => {
  const desktop = runtime(false);
  assert.throws(() => desktop.publishPlatform(), /desktop app/);
  assert.throws(() => desktop.runPublishTool("anything", []), /desktop app/);
});

test("tool runner preserves literal arguments, errors, cancellation, and timeout", async () => {
  const desktop = runtime();
  const argument = 'literal $(echo private); "quoted"';
  assert.equal(
    await desktop.runPublishTool(process.execPath, [
      "-e",
      "process.stdout.write(process.argv[1])",
      argument,
    ]),
    argument,
  );
  await assert.rejects(
    desktop.runPublishTool(process.execPath, [
      "-e",
      "process.stderr.write('Synthetic failure');process.exit(2)",
    ]),
    /Synthetic failure/,
  );
  await assert.rejects(
    desktop.runPublishTool(
      process.execPath,
      ["-e", "setTimeout(()=>{},10000)"],
      { timeout: 30 },
    ),
    /timed out/,
  );
  const aborter = new AbortController();
  aborter.abort();
  await assert.rejects(
    desktop.runPublishTool(process.execPath, [], { signal: aborter.signal }),
    /cancelled/,
  );
});

test("missing executable yields actionable setup state", async () => {
  const status = await runtime().detectPublishTool(
    "tectonic",
    "/missing-synthetic-tool",
  );
  assert.equal(status.path, "");
  assert.match(status.error!, /Could not start/);
});

test("native save cancellation leaves files untouched; save copies the bytes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "stratum-save-test-"));
  try {
    const protectedDir = join(directory, "published");
    await mkdir(protectedDir);
    const target = join(directory, "copy.pdf");
    let cancelled = true;
    const desktop = runtime(true, {
      dialog: {
        showSaveDialog: () =>
          Promise.resolve({ canceled: cancelled, filePath: target }),
      },
    });
    const bytes = new TextEncoder().encode("%PDF-synthetic").buffer;
    assert.equal(
      await desktop.savePublishedCopy(
        bytes,
        "Example.pdf",
        "pdf",
        protectedDir,
      ),
      false,
    );
    cancelled = false;
    assert.equal(
      await desktop.savePublishedCopy(
        bytes,
        "Example.pdf",
        "pdf",
        protectedDir,
      ),
      true,
    );
    assert.equal(await readFile(target, "utf8"), "%PDF-synthetic");
    const blocked = runtime(true, {
      dialog: {
        showSaveDialog: () =>
          Promise.resolve({
            canceled: false,
            filePath: join(protectedDir, "Example.pdf"),
          }),
      },
    });
    await assert.rejects(
      blocked.savePublishedCopy(bytes, "Example.pdf", "pdf", protectedDir),
      /outside/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test(
  "cancellation terminates descendants even when the parent exits first",
  { skip: process.platform === "win32" },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "stratum-cancel-test-"));
    const pidFile = join(directory, "child.pid");
    const aborter = new AbortController();
    let pid = 0;
    const child =
      "process.on('SIGTERM',()=>{});process.send('ready');setInterval(()=>{},1000)";
    const parent = `const {spawn}=require('node:child_process');const fs=require('node:fs');const child=spawn(process.execPath,['-e',process.argv[2]],{stdio:['ignore','ignore','ignore','ipc']});child.on('message',()=>fs.writeFileSync(process.argv[1],String(child.pid)));setInterval(()=>{},1000);`;
    const completion = runtime().runPublishTool(
      process.execPath,
      ["-e", parent, pidFile, child],
      { signal: aborter.signal, timeout: 5000 },
    );
    const outcome = completion.then(
      () => "completed",
      (error: Error) => error.message,
    );
    try {
      for (let i = 0; i < 200 && !pid; i++) {
        pid = Number(await readFile(pidFile, "utf8").catch(() => ""));
        if (!pid) await delay(10);
      }
      assert.ok(pid, "Synthetic child started");
      aborter.abort();
      assert.match(await outcome, /cancelled/);
      let alive = true;
      for (let i = 0; i < 100 && alive; i++) {
        try {
          process.kill(pid, 0);
        } catch {
          alive = false;
        }
        if (alive) await delay(10);
      }
      assert.equal(alive, false, "The cancelled child must not keep running");
    } finally {
      aborter.abort();
      await outcome;
      if (pid) {
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          /* Already stopped. */
        }
      }
      await rm(directory, { recursive: true, force: true });
    }
  },
);

test("GUI detection finds Homebrew tools without Terminal PATH and returns absolute paths", async () => {
  const launched: string[] = [];
  const desktop = runtime(true, undefined, {
    "node:process": { platform: "darwin", env: { PATH: "/usr/bin:/bin" } },
    "node:path": posix,
    "node:os": { homedir: () => "/synthetic-home" },
    "node:child_process": {
      spawn: (path: string) => {
        launched.push(path);
        const task = Object.assign(new EventEmitter(), {
          stdout: new EventEmitter(),
          stderr: new EventEmitter(),
        });
        queueMicrotask(() => {
          if (!path.startsWith("/opt/homebrew/bin/")) {
            task.emit(
              "error",
              Object.assign(new Error("Not found"), { code: "ENOENT" }),
            );
          } else {
            task.stdout.emit("data", `${posix.basename(path)} 1.0`);
            task.emit("close", 0);
          }
        });
        return task;
      },
    },
  });
  for (const tool of ["pandoc", "tectonic"] as const) {
    const found = await desktop.detectPublishTool(tool, "");
    assert.equal(found.path, `/opt/homebrew/bin/${tool}`);
    assert.equal(found.version, `${tool} 1.0`);
  }
  assert.ok(launched.includes("/usr/bin/pandoc"));
  const attempts = launched.length;
  const missing = await desktop.detectPublishTool("pandoc", "/custom/missing");
  assert.equal(
    missing.path,
    "",
    "explicit overrides must not silently fall back",
  );
  assert.equal(launched.length, attempts + 1);
});

test("an installed but unusable executable is distinct from a missing tool", async () => {
  const found = await runtime().detectPublishTool("pandoc", process.execPath);
  assert.equal(found.path, "");
  assert.ok(found.foundPath);
  assert.match(found.error!, /pandoc/);
});

for (const style of ["apa", "chicago-notes-bibliography", "ieee"]) {
  test(
    `real PDF publication preserves ${style} references in explicit and automatic bibliographies`,
    { skip: !pandoc || !tectonic },
    async () => {
      const styles = assets as Record<string, string>;
      for (const explicit of [false, true]) {
        const source =
          "A claim [@example2024]. Another claim [@other2025]." +
          (explicit ? '\n\n<div id="refs"></div>\n\nAfter references.' : "");
        const formatted = formatCitationDocument(
          source,
          styles[style],
          "en-US",
          styles,
          new Map([
            [
              "example2024",
              {
                id: "user/1/EXAMPLE",
                type: "book",
                title: "Synthetic reference",
                author: [{ family: "Example", given: "Alex" }],
                issued: { "date-parts": [[2024]] },
              },
            ],
            [
              "other2025",
              {
                id: "user/1/OTHER",
                type: "book",
                title: "Another synthetic reference",
                author: [{ family: "Other", given: "Sam" }],
                issued: { "date-parts": [[2025]] },
              },
            ],
          ]),
        );
        const originalBibliography = formatted.bibliography;
        const prepared = preparePublication(source, formatted);
        const html = (markdown: string) =>
          execFileSync(pandoc, ["-f", "markdown", "-t", "html"], {
            input: markdown,
            encoding: "utf8",
          });
        const document = `<html xmlns:epub="http://www.idpf.org/2007/ops"><body>${html(prepared.markdown)}${prepared.bibliography}${prepared.notes.map((note) => `<aside epub:type="footnote" id="${note.id}">${html(note.markdown)}</aside>`).join("")}</body></html>`;
        const latex = execFileSync(
          pandoc,
          ["-f", "html+epub_html_exts", "-t", "latex"],
          { input: document, encoding: "utf8" },
        );
        assert.equal((latex.match(/\\bibitem\[/g) ?? []).length, 2);
        assert.match(latex, /synthetic reference/i);
        assert.equal(
          formatted.bibliography,
          originalBibliography,
          "Reading-view output stays unchanged",
        );
        if (style !== "ieee")
          assert.match(
            latex,
            /\\begin\{CSLReferences\}\{1\}/,
            "preserves hanging indentation",
          );
        if (explicit)
          assert.ok(
            latex.indexOf("\\end{CSLReferences}") <
              latex.indexOf("After references"),
          );
        if (style === "chicago-notes-bibliography")
          assert.equal((latex.match(/\\footnote\{/g) ?? []).length, 2);
        const bytes = await runtime().convertPublication(document, [], "pdf", {
          workspace: testPublishingWorkspace(),
          pandoc,
          tectonic,
        });
        assert.equal(
          new TextDecoder().decode(new Uint8Array(bytes).subarray(0, 5)),
          "%PDF-",
        );
      }
    },
  );
}

// Poppler reports its version with -v; --version exits with an error.
const pdftotext =
  [
    process.env.STRATUM_TEST_PDFTOTEXT,
    "pdftotext",
    "/opt/homebrew/bin/pdftotext",
    "/usr/local/bin/pdftotext",
  ].find((candidate) => {
    if (!candidate) return false;
    try {
      execFileSync(candidate, ["-v"], { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  }) ?? "";
const keywordPaper = `<html><body><div class="stratum-publish-title"><p>Synthetic keyword paper</p></div><div class="stratum-publish-abstract"><h1 class="unnumbered">Abstract</h1><p>Synthetic summary.</p></div><div class="stratum-publish-keywords"><p>Keywords: alpha, beta</p></div><h1>Introduction</h1><p>Synthetic body.</p></body></html>`;

test(
  "real PDF export keeps keywords after the abstract",
  { skip: !pandoc || !tectonic || !pdftotext },
  async () => {
    const bytes = await runtime().convertPublication(
      keywordPaper,
      [],
      "pdf",
      { workspace: testPublishingWorkspace(), pandoc, tectonic },
      undefined,
      120_000,
      DEFAULT_ACADEMIC_OPTIONS,
    );
    const text = execFileSync(pdftotext, ["-", "-"], {
      input: new Uint8Array(bytes),
      encoding: "utf8",
    }).replace(/\s+/g, " ");
    const summary = text.indexOf("Synthetic summary.");
    const keywords = text.indexOf("Keywords: alpha, beta");
    assert.ok(summary >= 0 && keywords > summary, text);
    assert.ok(keywords < text.indexOf("Introduction"), text);
  },
);

test(
  "LaTeX layout wraps only wide tables and lets bibliography URLs break",
  { skip: !hasPandoc },
  async () => {
    const { publicationFilter } = await import("../publish-layout");
    const directory = await mkdtemp(join(tmpdir(), "stratum-layout-"));
    try {
      await writeFile(
        join(directory, "layout.lua"),
        publicationFilter(DEFAULT_ACADEMIC_OPTIONS),
      );
      await writeFile(
        join(directory, "document.html"),
        `<table><thead><tr><th>Feature</th><th>First synthetic column</th><th>Second synthetic column</th><th>Third synthetic column</th></tr></thead><tbody><tr><td>Response</td><td>A long synthetic description</td><td>Another long synthetic description</td><td>A third long synthetic description</td></tr></tbody></table>
<table><thead><tr><th>Group</th><th>Count</th></tr></thead><tbody><tr><td>Low</td><td>40</td></tr></tbody></table>
<div class="csl-bib-body"><div id="ref-stratum-publish-footer-0" class="csl-entry">Example, A. (2024). Synthetic reference. https://doi.org/10.0000/synthetic.2024.</div>
<div id="ref-stratum-publish-footer-1" class="csl-entry">Example, B. (2024). Linked reference. <a href="https://example.com/linked">https://example.com/linked</a></div></div>`,
      );
      const latex = execFileSync(
        pandoc,
        [
          "--from=html",
          "--to=latex",
          "--lua-filter=layout.lua",
          "document.html",
        ],
        { cwd: directory, encoding: "utf8", timeout: 30_000 },
      );
      assert.equal(
        latex.match(/p\{\(/g)?.length,
        4,
        "Only the wide table gets wrapping columns",
      );
      assert.match(
        latex,
        /\\url\{https:\/\/doi\.org\/10\.0000\/synthetic\.2024\}\./,
      );
      assert.match(latex, /\\url\{https:\/\/example\.com\/linked\}/);
      assert.doesNotMatch(latex, /\\href\{[^}]*\}\{\\url/);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);

test(
  "PDF readiness reports missing Tectonic without attempting conversion",
  { skip: !hasPandoc },
  async () => {
    const result = await runtime().checkPublishing(
      pandoc,
      "/missing-synthetic-tectonic",
      false,
      testPublishingWorkspace(),
    );
    assert.equal(result.pdf, false);
    assert.match(result.tectonic.error!, /Could not start/);
  },
);

test(
  "real PDF setup verifies Pandoc and Tectonic",
  { skip: !pandoc || !tectonic },
  async () => {
    const updates: Desktop.PublishReadiness[] = [];
    const result = await runtime().checkPublishing(
      pandoc,
      tectonic,
      true,
      testPublishingWorkspace(),
      undefined,
      undefined,
      (state) => updates.push(state),
    );
    assert.equal(updates[0].pdf, false);
    assert.ok(
      updates[0].tectonic.path,
      "tools appear before conversion finishes",
    );
    assert.equal(result.pdf, true, result.pdfError);
  },
);

test(
  "real General and Academic PDFs honor structured affiliation visibility without changing metadata",
  { skip: !pandoc || !tectonic || !pdftotext },
  async () => {
    const { mappedPublishingProperties, publicationProperties } =
      await import("../publish-properties");
    const { publicationAuthors } = await import("../publication-metadata");
    const academic = loadRuntime<typeof import("../publish-academic")>(
      "publish-academic.ts",
      { parseYaml: JSON.parse },
      {},
      "node",
      { "./publication-metadata": { publicationAuthors } },
    );
    const properties = {
      stratum_publish: {
        authors: [
          {
            name: "Synthetic Writer",
            email: "writer@example.org",
            affiliations: ["Synthetic Laboratory"],
          },
        ],
      },
    };
    const original = JSON.stringify(properties);
    for (const defaults of [DEFAULT_PUBLISH_OPTIONS, DEFAULT_ACADEMIC_OPTIONS])
      for (const showAuthors of [false, true])
        for (const showAffiliations of [false, true]) {
          const options = {
            ...defaults,
            titleSource: "body" as const,
            showAuthors,
            showAffiliations,
          };
          const opening = academic.academicOpening(
            academic.academicMetadata(
              mappedPublishingProperties(
                properties,
                publicationProperties(options),
              ),
            ),
            false,
          );
          const html = `<html><body>${opening}<h1>Introduction</h1><p>Synthetic manuscript body.</p></body></html>`;
          const bytes = await runtime().convertPublication(
            html,
            [],
            "pdf",
            { workspace: testPublishingWorkspace(), pandoc, tectonic },
            undefined,
            120_000,
            options,
          );
          const directory = await mkdtemp(
            join(tmpdir(), "stratum-affiliation-pdf-"),
          );
          let text: string;
          try {
            const filename = join(directory, "Synthetic.pdf");
            await writeFile(filename, new Uint8Array(bytes));
            text = execFileSync(pdftotext, [filename, "-"], {
              encoding: "utf8",
            });
          } finally {
            await rm(directory, { recursive: true, force: true });
          }
          assert.equal(text.includes("Synthetic Writer"), showAuthors);
          assert.equal(text.includes("Synthetic Laboratory"), showAffiliations);
          assert.equal(JSON.stringify(properties), original);
        }
  },
);

test("mirror download bounds HTTPS redirects, busy responses, bytes, hash and total time", async () => {
  const bytes = new TextEncoder().encode("Synthetic bibliography style");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  type Hop = {
    status?: number;
    location?: string;
    bytes?: Uint8Array;
    wait?: number;
    length?: string;
  };
  let hops: Hop[] = [];
  let urls: string[] = [];
  let destroyed = 0;
  const requests: EventEmitter[] = [];
  const https = {
    get(
      url: string,
      _options: unknown,
      callback: (response: EventEmitter) => void,
    ) {
      urls.push(url);
      const hop = hops.shift();
      assert.ok(hop, "unexpected network hop");
      const request = new EventEmitter() as EventEmitter & {
        destroy(error?: Error): void;
      };
      request.destroy = (error) => {
        if (error) request.emit("error", error);
      };
      requests.push(request);
      schedule(() => {
        const response = new EventEmitter() as EventEmitter & {
          statusCode: number;
          headers: { location?: string; "content-length"?: string };
          destroy(): void;
        };
        response.statusCode = hop.status ?? 200;
        response.headers = {
          location: hop.location,
          "content-length": hop.length,
        };
        response.destroy = () => {
          destroyed++;
        };
        callback(response);
        if (response.statusCode === 200) {
          response.emit("data", hop.bytes ?? bytes);
          response.emit("end");
        }
        request.emit("close");
      }, hop.wait ?? 0);
      return request;
    },
  };
  const { downloadPublicationResource: download } = runtime(true, undefined, {
    "node:https": https,
  });
  const run = (
    next: Hop[],
    timeout = 1000,
    url = "https://templates.stratumnotes.com/api/templates/v1/test/download",
  ) => {
    hops = [...next];
    urls = [];
    destroyed = 0;
    return download({ url, sha256 }, undefined, timeout);
  };
  assert.deepEqual(Array.from(await run([{}])), Array.from(bytes));
  for (const status of [301, 302, 303, 307, 308]) {
    await assert.rejects(
      run([{ status, location: "https://cdn.test/style" }]),
      /redirected/,
    );
    assert.equal(urls.length, 1);
    assert.equal(destroyed, 1);
  }
  for (const status of [429, 503]) {
    await assert.rejects(
      run([{ status }]),
      status === 429 ? /mirror is busy.*one minute/ : /HTTP 503/,
    );
    assert.equal(urls.length, 1, "Busy responses are not retried");
    assert.equal(destroyed, 1);
  }
  await assert.rejects(run([{ length: "1000001" }]), /too large/);
  await assert.rejects(run([{ length: "999" }]), /interrupted/);
  await assert.rejects(run([{ length: "invalid" }]), /invalid/);
  await assert.rejects(
    run([{ bytes: new Uint8Array(1_000_001) }]),
    /too large/,
  );
  await assert.rejects(
    run([{ bytes: new Uint8Array([1]) }]),
    /template resource changed/,
  );
  await assert.rejects(run([{ wait: 80 }], 20), /timed out/);
  await delay(100);
  assert.equal(destroyed, 1);
  for (const url of [
    "http://unsafe.test/style",
    "https://upstream.test/style",
    "https://user:secret@templates.stratumnotes.com/style",
  ]) {
    await assert.rejects(run([], 1000, url), /requires HTTPS/);
    assert.equal(urls.length, 0);
  }
});

test("explicit loopback development origin allows HTTP without opening other origins", async () => {
  const bytes = new TextEncoder().encode("Synthetic local registry response");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  let calls = 0;
  const http = {
    get(_url: string, _options: unknown, callback: (r: EventEmitter) => void) {
      calls++;
      const request = new EventEmitter();
      schedule(() => {
        const response = Object.assign(new EventEmitter(), {
          statusCode: 200,
          headers: {},
          destroy() {},
        });
        callback(response);
        response.emit("data", bytes);
        response.emit("end");
        request.emit("close");
      }, 0);
      return request;
    },
  };
  const { downloadPublicationResource: download } = runtime(
    true,
    undefined,
    { "node:http": http },
    { __STRATUM_TEMPLATE_REGISTRY_ORIGIN__: "http://localhost:8788" },
  );
  assert.deepEqual(
    Array.from(
      await download({
        url: "http://localhost:8788/api/templates/v1/example",
        sha256,
      }),
    ),
    Array.from(bytes),
  );
  for (const url of [
    "http://localhost:8789/private",
    "http://example.org/private",
    "http://user:secret@localhost:8788/private",
  ])
    await assert.rejects(download({ url, sha256 }), /requires HTTPS/);
  assert.equal(calls, 1);
});

test(
  "installed AASTeX and standard adapters share citation, table, image and math conversion",
  { skip: !pandoc },
  async () => {
    const { installationFixture } =
      await import("./publication-installation-fixture");
    const { installedJournalProfile } =
      await import("../publication-installed-templates");
    const { publicationManuscript } = await import("../publication-manuscript");
    const { publicationReferences, journalFormattedDocument } =
      await import("../publication-citations");
    const child =
      require("node:child_process") as typeof import("node:child_process");
    const image = new Uint8Array([137, 80, 78, 71]).buffer;
    const reference = {
      id: "key",
      type: "article-journal",
      title: "Synthetic reference",
      author: [{ family: "Example" }],
      issued: { "date-parts": [[2024]] },
    };
    const { ids, references } = publicationReferences(["key"], [reference]);
    const manuscript = publicationManuscript(
      "---\nstratum_publish:\n  authors:\n    - name: Synthetic Author\n      affiliations: [Synthetic Institute]\n---\n# Synthetic title\n## Abstract\nSynthetic abstract.\n## Results\nBody",
      "body",
    );
    const bodies: string[] = [];
    for (const frontMatter of ["aastex7", "standard"] as const) {
      const installation = installationFixture().manifest;
      installation.adapter.frontMatter = frontMatter;
      installation.adapter.citations = "author-year";
      const journal = installedJournalProfile(installation);
      const citation = journalFormattedDocument(
        "[@key]",
        ids,
        references,
        false,
      ).citations[0];
      let scratch = "";
      const desktop = loadRuntime<typeof Desktop>(
        "publish-desktop.ts",
        { Platform: { isDesktopApp: true, isDesktop: true } },
        {
          TextDecoder,
          TextEncoder,
          Uint8Array,
          window: {
            setTimeout,
            clearTimeout,
            require: (name: string): unknown =>
              name === "node:child_process"
                ? {
                    spawn: (
                      executable: string,
                      args: string[],
                      options: { cwd: string },
                    ) => {
                      if (executable !== "synthetic-tectonic")
                        return child.spawn(executable, args, options);
                      const task = Object.assign(new EventEmitter(), {
                        stdout: new EventEmitter(),
                        stderr: new EventEmitter(),
                        kill: () => true,
                      });
                      scratch = options.cwd;
                      void (async () => {
                        await Promise.resolve();
                        try {
                          assert.deepEqual(Array.from(args), [
                            "--untrusted",
                            "--keep-logs",
                            "--keep-intermediates",
                            "document.tex",
                          ]);
                          const body = await readFile(
                            join(scratch, "body.tex"),
                            "utf8",
                          );
                          bodies.push(body);
                          assert.match(body, /\\citep\{stratum0\}/);
                          assert.match(body, /\\begin\{tabular\}\{ll\}/);
                          assert.match(
                            body,
                            /\\multicolumn\{1\}\{r\}\{Count\}/,
                          );
                          assert.match(body, /\\includegraphics.*asset-0\.png/);
                          assert.match(body, /x\^2/);
                          assert.match(body, /\\alpha/);
                          assert.match(body, /1\. Literal heading/);
                          assert.deepEqual(
                            new Uint8Array(
                              await readFile(join(scratch, "asset-0.png")),
                            ),
                            new Uint8Array(image),
                          );
                          const tex = await readFile(
                            join(scratch, "document.tex"),
                            "utf8",
                          );
                          assert.match(tex, /\\bibliographystyle\{style\}/);
                          assert.match(tex, /\\bibliography\{references\}/);
                          assert.match(
                            tex,
                            frontMatter === "aastex7"
                              ? /\\affiliation\{Synthetic Institute\}/
                              : /Synthetic Institute/,
                          );
                          assert.match(
                            await readFile(
                              join(scratch, "references.bib"),
                              "utf8",
                            ),
                            /Synthetic reference/i,
                          );
                          await writeFile(
                            join(scratch, "document.aux"),
                            "\\bibcite{stratum0}{1}",
                          );
                          await writeFile(
                            join(scratch, "document.log"),
                            "Synthetic compiler boundary",
                          );
                          await writeFile(
                            join(scratch, "document.pdf"),
                            "%PDF-Synthetic compiler boundary",
                          );
                          task.emit("close", 0);
                        } catch (error) {
                          task.emit("error", error);
                        }
                      })();
                      return task;
                    },
                  }
                : require(name),
          },
        },
        "browser",
        {
          // Resource hash verification is covered by installation/resource tests.
          // Exercise real Pandoc and stop at the compiler boundary without downloading classes.
          "./publication-resources": {
            installedTemplateResources: () =>
              Promise.resolve({
                "class.cls": new TextEncoder().encode(
                  "Synthetic verified resource",
                ),
              }),
          },
        },
      );
      const bytes = await desktop.convertPublication(
        `<h1>1. Literal heading</h1><p>${citation}</p><table><thead><tr><th>Group</th><th style="text-align:right">Count</th></tr></thead><tbody><tr><td>Example</td><td>2</td></tr></tbody></table><p><img src="asset-0.png" alt="Synthetic"></p><p><span class="math inline">\\(x^2 + \\alpha\\)</span></p>`,
        [{ name: "asset-0.png", bytes: image }],
        "pdf",
        {
          workspace: testPublishingWorkspace(),
          pandoc,
          tectonic: "synthetic-tectonic",
          bibliographyCache: {} as never,
        },
        undefined,
        120000,
        undefined,
        {
          journal,
          manuscript,
          abstractHtml: "<p>Synthetic abstract.</p>",
          references,
        },
      );
      assert.match(new TextDecoder().decode(bytes), /^%PDF-/);
      await assert.rejects(readFile(join(scratch, "document.tex")), {
        code: "ENOENT",
      });
    }
    assert.equal(bodies.length, 2);
    assert.equal(bodies[0], bodies[1]);
  },
);

test(
  "numeric citation output compiles with native LaTeX and natbib",
  { skip: !tectonic },
  async () => {
    const { journalFormattedDocument } =
      await import("../publication-citations");
    const formatted = journalFormattedDocument(
      "Evidence [@first; @second]. @first reports results. More evidence [see @first, p. 12].",
      new Map([
        ["first", "stratum0"],
        ["second", "stratum1"],
      ]),
      [
        {
          id: "stratum0",
          type: "article-journal",
          author: [{ family: "Example" }],
        },
        {
          id: "stratum1",
          type: "article-journal",
          author: [{ family: "Synthetic" }],
        },
      ],
      true,
    );
    const body = formatted.citations
      .map((citation) => {
        const match = /data-tex="([^"]*)"/.exec(citation);
        assert.ok(match);
        return match[1];
      })
      .join("\n\n");
    for (const natbib of [false, true]) {
      const directory = await mkdtemp(
        join(tmpdir(), "stratum-citation-compat-"),
      );
      try {
        await writeFile(
          join(directory, "document.tex"),
          [
            String.raw`\documentclass{article}`,
            natbib ? String.raw`\usepackage[numbers]{natbib}` : "",
            String.raw`\begin{document}`,
            body,
            String.raw`\begin{thebibliography}{2}
\bibitem{stratum0} Alex Example. Synthetic reference.
\bibitem{stratum1} Sam Synthetic. Second reference.
\end{thebibliography}
\end{document}`,
          ].join("\n"),
        );
        execFileSync(tectonic, ["--untrusted", "--keep-logs", "document.tex"], {
          cwd: directory,
          timeout: 60_000,
          stdio: "pipe",
        });
        assert.equal(
          (await readFile(join(directory, "document.pdf")))
            .subarray(0, 5)
            .toString(),
          "%PDF-",
        );
        assert.doesNotMatch(
          await readFile(join(directory, "document.log"), "utf8"),
          /Undefined control sequence|Citation .* undefined/,
        );
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    }
  },
);

test("conversion cleans adapter scratch files on failure and cancellation without loading fs", async () => {
  const modules = Object.defineProperty({}, "node:fs/promises", {
    get() {
      throw new Error("Conversion must not load Node fs");
    },
  });
  const desktop = runtime(true, undefined, modules);
  for (const cancelled of [false, true]) {
    const directories: string[] = [];
    const aborter = new AbortController();
    if (cancelled) aborter.abort();
    await assert.rejects(
      desktop.convertPublication(
        "<p>Synthetic</p>",
        [],
        "pdf",
        {
          workspace: testPublishingWorkspace((directory) =>
            directories.push(directory),
          ),
          pandoc: "/missing-synthetic-publishing-tool",
          tectonic: "unused",
        },
        aborter.signal,
      ),
      cancelled ? /cancelled/ : /Could not start/,
    );
    assert.equal(directories.length, 1);
    await assert.rejects(access(directories[0]));
  }
});
