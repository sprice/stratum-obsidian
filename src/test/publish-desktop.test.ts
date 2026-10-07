import test from "node:test";
import { EventEmitter } from "node:events";
import { posix } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, writeFile, readFile, rm, mkdir } from "node:fs/promises";
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
) {
  return loadRuntime<typeof Desktop>(
    "publish-desktop.ts",
    { Platform: { isDesktopApp: desktop, isDesktop: desktop } },
    {
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
  "real Word export applies selected fonts, sizes, page layout and native equations",
  { skip: !hasPandoc },
  async () => {
    const math = preparePublishMath(
      "$x^2$ and $$\\begin{bmatrix}1&2\\\\3&4\\end{bmatrix}$$",
    );
    const html = `<html><head><title>Unwanted metadata title</title></head><body><div class="stratum-publish-title"><p>Synthetic academic title</p></div><div class="stratum-publish-authors"><p>Alex Example</p></div><h2>Introduction</h2><p>${math.restore(math.markdown)}</p><p>Body text with <code>code</code>.</p></body></html>`;
    const options = {
      ...DEFAULT_PUBLISH_OPTIONS,
      bodyFont: "Georgia",
      titleFont: "Arial",
      bodySize: 11,
      titleSize: 28,
      paperSize: "a4" as const,
      margin: 0.8,
      lineSpacing: 1.5,
    };
    const bytes = await runtime().convertPublication(
      html,
      [],
      "docx",
      { pandoc, tectonic },
      undefined,
      120_000,
      options,
    );
    const directory = await mkdtemp(join(tmpdir(), "stratum-layout-test-"));
    try {
      const output = join(directory, "Synthetic.docx");
      await writeFile(output, new Uint8Array(bytes));
      const xml = (entry: string) =>
        execFileSync(
          "python3",
          [
            "-c",
            "import zipfile,sys; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; print(z.read(sys.argv[2]).decode())",
            output,
            entry,
          ],
          { encoding: "utf8" },
        );
      const main = xml("word/document.xml"),
        styles = xml("word/styles.xml");
      assert.match(main, /<m:oMath/);
      assert.doesNotMatch(main, /Unwanted metadata title/);
      assert.doesNotMatch(main, /\\begin|\\\(|stratum-publish-math/);
      assert.match(main, /w:pStyle w:val="Title"/);
      assert.match(main, /w:w="11906"/);
      assert.match(main, /w:top="1152"/);
      assert.match(styles, /w:ascii="Georgia"/);
      assert.match(styles, /w:ascii="Arial"/);
      assert.match(styles, /w:sz w:val="56"/);
      assert.match(styles, /w:line="360"/);
      assert.match(styles, /w:styleId="Title"[\s\S]*?<w:jc w:val="left"/);
      assert.match(
        styles,
        /w:styleId="Abstract"[\s\S]*?<w:ind w:left="0" w:right="0"/,
      );
      assert.match(xml("word/stratum-footer.xml"), / PAGE /);
      // Section children must keep WordprocessingML order.
      assert.match(
        main,
        /<w:sectPr><w:footerReference [^>]*\/>\s*<w:footnotePr>[\s\S]*<\/w:footnotePr>\s*<w:pgSz [^>]*\/><w:pgMar [^>]*\/><\/w:sectPr>/,
      );
      assert.match(
        styles,
        /w:styleId="VerbatimChar"[\s\S]*?w:ascii="Consolas"[\s\S]*?<\/w:style>/,
      );
      assert.match(
        styles,
        /<w:rPrDefault>[\s\S]*?<w:lang [\s\S]*?<\/w:rPrDefault>/,
      );
      assert.match(
        styles,
        /w:styleId="Heading1"[\s\S]*?<w:rFonts [^>]*\/><w:b\/><w:sz /,
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);

test(
  "real PDF export accepts default fonts, academic opening and mathematical notation",
  { skip: !pandoc || !tectonic },
  async () => {
    const math = preparePublishMath(
      "$$\\int_0^1 x^2\\,\\mathrm{d}x = \\frac{1}{3}$$",
    );
    const html = `<html><head><title>Unwanted metadata title</title></head><body><div class="stratum-publish-title"><p>Synthetic mathematical paper</p></div><div class="stratum-publish-abstract"><h2 class="unnumbered">Abstract</h2><p>A synthetic abstract.</p></div><h2>Introduction</h2><p>${math.restore(math.markdown)}</p></body></html>`;
    const bytes = await runtime().convertPublication(
      html,
      [],
      "pdf",
      { pandoc, tectonic },
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
        { pandoc, tectonic },
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
      { pandoc: "", tectonic: "" },
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
      { pandoc: "", tectonic: "" },
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
      { pandoc: "", tectonic: "" },
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
  "real Pandoc export contains native footnotes, citations, tables, links and bibliography",
  { skip: !hasPandoc },
  async () => {
    const text =
      "# Example manuscript\n\nA claim [@example2024]. Explanation[^note]. Again [@example2024].\n\n[^note]: A **native** note. See [the footnote source][footnote-source].\n\n[footnote-source]: https://example.com/footnote-source\n\n| Heading | Value |\n| --- | --- |\n| First | Second |\n\n[External](https://example.com)";
    const styles = assets as Record<string, string>;
    const result = formatCitationDocument(
      text,
      styles["chicago-notes-bibliography"],
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
      ]),
    );
    const prepared = preparePublication(text, result);
    const html = (markdown: string) =>
      execFileSync(pandoc, ["-f", "markdown", "-t", "html"], {
        input: markdown,
        encoding: "utf8",
      });
    const document = `<html><body>${html(prepared.markdown)}<h2>${prepared.heading}</h2>${prepared.bibliography}${prepared.notes.map((n) => `<aside epub:type="footnote" id="${n.id}">${html(n.markdown)}</aside>`).join("")}</body></html>`;
    const bytes = await runtime().convertPublication(document, [], "docx", {
      pandoc,
      tectonic: "",
    });
    const directory = await mkdtemp(join(tmpdir(), "stratum-docx-test-"));
    try {
      const output = join(directory, "Example.docx");
      await writeFile(output, new Uint8Array(bytes));
      const readZip = (entry: string) =>
        execFileSync(
          "python3",
          [
            "-c",
            "import zipfile,sys; print(zipfile.ZipFile(sys.argv[1]).read(sys.argv[2]).decode())",
            output,
            entry,
          ],
          { encoding: "utf8" },
        );
      const main = readZip("word/document.xml"),
        notes = readZip("word/footnotes.xml");
      assert.equal((main.match(/<w:footnoteReference /g) ?? []).length, 3);
      assert.match(main, /<w:tbl>/);
      assert.match(main, /Bibliography/);
      assert.match(main, /Synthetic reference/i);
      assert.match(notes, /Alex Example/);
      assert.match(notes, /native/);
      assert.match(
        readZip("word/_rels/footnotes.xml.rels"),
        /https:\/\/example.com\/footnote-source/,
      );
      assert.match(
        readZip("word/_rels/document.xml.rels"),
        /https:\/\/example.com/,
      );
      assert.doesNotMatch(
        main,
        /@example2024|epub:type|stratum-citation-evidence/,
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);

test(
  "readiness verifies real Word conversion and independently reports missing Tectonic",
  { skip: !hasPandoc },
  async () => {
    const result = await runtime().checkPublishing(
      pandoc,
      "/missing-synthetic-tectonic",
      false,
    );
    assert.equal(result.word, true);
    assert.equal(result.pdf, false);
    assert.match(result.tectonic.error!, /Could not start/);
  },
);

test(
  "real PDF setup uses Pandoc and Tectonic",
  { skip: !pandoc || !tectonic },
  async () => {
    const updates: Desktop.PublishReadiness[] = [];
    const result = await runtime().checkPublishing(
      pandoc,
      tectonic,
      true,
      undefined,
      undefined,
      (state) => updates.push(state),
    );
    assert.equal(updates[0].word, false);
    assert.ok(
      updates[0].tectonic.path,
      "tools appear before conversion finishes",
    );
    assert.equal(updates[1].word, true);
    assert.equal(updates[1].pdf, false, "Word is ready while PDF prepares");
    assert.equal(result.word, true, result.wordError);
    assert.equal(result.pdf, true, result.pdfError);
  },
);

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
    "node:fs/promises": {
      realpath: (path: string) =>
        path.startsWith("/opt/homebrew/bin/")
          ? Promise.resolve(path.replace("/bin/", "/opt/bin/"))
          : Promise.reject(new Error("Not found")),
    },
    "node:child_process": {
      spawn: (path: string) => {
        launched.push(path);
        const task = Object.assign(new EventEmitter(), {
          stdout: new EventEmitter(),
          stderr: new EventEmitter(),
        });
        queueMicrotask(() => {
          task.stdout.emit("data", `${posix.basename(path)} 1.0`);
          task.emit("close", 0);
        });
        return task;
      },
    },
  });
  for (const tool of ["pandoc", "tectonic"] as const) {
    const found = await desktop.detectPublishTool(tool, "");
    assert.equal(found.path, `/opt/homebrew/opt/bin/${tool}`);
    assert.equal(found.version, `${tool} 1.0`);
  }
  assert.equal(
    launched.length,
    2,
    "missing candidates should not spawn processes",
  );
  const missing = await desktop.detectPublishTool("pandoc", "/custom/missing");
  assert.equal(
    missing.path,
    "",
    "explicit overrides must not silently fall back",
  );
  assert.equal(launched.length, 2);
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

test(
  "real Word export rejects lost equations but allows unrelated warnings",
  { skip: !hasPandoc },
  async () => {
    const desktop = runtime();
    await assert.rejects(
      desktop.convertPublication(
        '<html><body><p><span class="math inline">\\(\\syntheticunknown{x}\\)</span></p></body></html>',
        [],
        "docx",
        { pandoc, tectonic },
      ),
      /An equation could not be converted to Word.*publish to PDF/,
    );
    // Duplicate identifiers warn in Pandoc, but do not prevent native equation conversion.
    const bytes = await desktop.convertPublication(
      '<html><body><h1 id="same">One</h1><h1 id="same">Two</h1><p><span class="math inline">\\(x^2\\)</span></p></body></html>',
      [],
      "docx",
      { pandoc, tectonic },
    );
    assert.equal(new Uint8Array(bytes)[0], 0x50);
  },
);

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
  "real Word export keeps keywords after the abstract",
  { skip: !hasPandoc },
  async () => {
    const bytes = await runtime().convertPublication(
      keywordPaper,
      [],
      "docx",
      { pandoc, tectonic },
      undefined,
      120_000,
      DEFAULT_ACADEMIC_OPTIONS,
    );
    const directory = await mkdtemp(join(tmpdir(), "stratum-keywords-test-"));
    try {
      const output = join(directory, "Synthetic.docx");
      await writeFile(output, new Uint8Array(bytes));
      const main = execFileSync(
        "python3",
        [
          "-c",
          "import zipfile,sys; print(zipfile.ZipFile(sys.argv[1]).read('word/document.xml').decode())",
          output,
        ],
        { encoding: "utf8" },
      );
      const summary = main.indexOf("Synthetic summary.");
      const keywords = main.indexOf("Keywords: alpha, beta");
      assert.ok(summary >= 0 && keywords > summary);
      assert.ok(keywords < main.indexOf("Introduction"));
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);

test(
  "real PDF export keeps keywords after the abstract",
  { skip: !pandoc || !tectonic || !pdftotext },
  async () => {
    const bytes = await runtime().convertPublication(
      keywordPaper,
      [],
      "pdf",
      { pandoc, tectonic },
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
