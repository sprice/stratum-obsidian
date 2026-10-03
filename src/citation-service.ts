import {
  citationResolver,
  type CitationResolution,
} from "./citation-resolution";
import {
  Component,
  MarkdownView,
  TFile,
  parseYaml,
  type TAbstractFile,
} from "obsidian";
import type StratumPlugin from "./plugin";
import { buildCitekey } from "./bibtex-format";
import {
  buildLiteratureNoteEntries,
  literatureNoteEntryFromFrontmatter,
} from "./library-search-modal";
import { citationAuthoringDocument } from "./citation-document";
import { readBibliographyBindings } from "./document-sources";
import { loadReferenceStore, REFERENCE_FILE } from "./citation-reference-store";
import { cachedLocales, cachedStyle } from "./citation-styles";
import type { FormattedDocument } from "./citation-format";
import type { CslItem } from "./csl-data";
export class CitationService extends Component {
  private invalidationTimer: number | null = null;
  private signatures = new Map<string, string>();
  private knownKeys: Set<string> | null = null;
  private intent = new Map<string, boolean>();
  private keyRead: Promise<void> | null = null;
  private previewTimer: number | null = null;
  private previewPaths = new Set<string>();
  private revision = 0;
  private formatters = new Map<string, (text: string) => FormattedDocument>();
  private managed = new Set<string>();
  private refs: Promise<(key: string) => CitationResolution> | null = null;
  private results = new Map<
    string,
    { text: string; revision: number; result: Promise<FormattedDocument> }
  >();
  private listeners = new Set<(path?: string) => void>();
  constructor(readonly plugin: StratumPlugin) {
    super();
  }
  onload(): void {
    this.registerEvent(
      this.plugin.app.metadataCache.on("changed", (file) => changed(file)),
    );
    const changed = (file: TAbstractFile) => {
      const managed =
        file instanceof TFile &&
        this.plugin.app.metadataCache.getFileCache(file)?.frontmatter
          ?.stratum_note_type === "literature-note";
      if (managed && file instanceof TFile) {
        const entry = literatureNoteEntryFromFrontmatter(
          file,
          this.plugin.app.metadataCache.getFileCache(file)?.frontmatter ?? {},
        );
        const { file: _file, ...metadata } = entry;
        const fm =
          this.plugin.app.metadataCache.getFileCache(file)?.frontmatter;
        const signature = JSON.stringify([
          metadata,
          fm?.stratum_citation_style,
          fm?.stratum_citation_language,
        ]);
        if (this.signatures.get(file.path) === signature) {
          this.results.delete(file.path);
          this.refreshReadingView(file.path);
          return;
        }
        this.signatures.set(file.path, signature);
        this.managed.add(file.path);
      }
      if (
        file.path === "stratum.bib" ||
        file.path === REFERENCE_FILE ||
        managed ||
        this.managed.has(file.path)
      )
        this.scheduleInvalidation();
      else if (file.path.endsWith(".md")) {
        this.refreshReadingView(file.path);
        this.results.delete(file.path);
      }
    };
    this.plugin.app.workspace?.onLayoutReady?.(() => {
      this.registerEvent(this.plugin.app.vault.on("create", changed));
    });
    this.registerEvent(this.plugin.app.vault.on("modify", changed));
    this.registerEvent(
      this.plugin.app.vault.on("delete", (file) => {
        this.signatures.delete(file.path);
        changed(file);
      }),
    );
    this.registerEvent(
      this.plugin.app.vault.on("rename", (file, oldPath) => {
        // Renaming a bibliography or reference store away changes the available
        // references just as deleting it does. The event supplies the new path.
        if (
          oldPath === "stratum.bib" ||
          oldPath === REFERENCE_FILE ||
          this.managed.delete(oldPath)
        )
          this.invalidate();
        this.results.delete(oldPath);
        this.signatures.delete(oldPath);
        changed(file);
      }),
    );
  }
  private scheduleInvalidation(): void {
    if (this.invalidationTimer !== null)
      window.clearTimeout(this.invalidationTimer);
    this.invalidationTimer = window.setTimeout(() => {
      this.invalidationTimer = null;
      this.invalidate();
    }, 200);
  }
  async hasCitationIntent(text: string): Promise<boolean> {
    if (!text.includes("@")) return false;
    const previous = this.intent.get(text);
    if (previous !== undefined) return previous;
    const model = citationAuthoringDocument(text);
    let result = model.citations.some(
      (c) => !c.draft.narrative || this.knownKey(c.draft.items[0].key),
    );
    if (!result && model.citations.length) {
      const revision = this.revision;
      this.keyRead ??= (async () => {
        const file = this.plugin.app.vault.getAbstractFileByPath("stratum.bib");
        if (!(file instanceof TFile)) return;
        const bindings = readBibliographyBindings(
          await this.plugin.app.vault.read(file),
        );
        if (revision !== this.revision) return;
        this.knownKeys ??= new Set();
        for (const binding of bindings) this.knownKeys.add(binding.key);
      })().catch(() => {
        this.keyRead = null;
      });
      await this.keyRead;
      if (revision !== this.revision) return false;
      result = model.citations.some((c) => this.knownKey(c.draft.items[0].key));
    }
    if (this.intent.size >= 12) this.intent.clear();
    this.intent.set(text, result);
    return result;
  }
  knownKey(key: string): boolean {
    this.knownKeys ??= new Set(
      buildLiteratureNoteEntries(this.plugin).map((entry) =>
        buildCitekey(entry),
      ),
    );
    return this.knownKeys.has(key);
  }
  private refreshReadingView(path: string): void {
    this.previewPaths.add(path);
    if (this.previewTimer !== null) window.clearTimeout(this.previewTimer);
    this.previewTimer = window.setTimeout(() => {
      this.previewTimer = null;
      const paths = new Set(this.previewPaths);
      this.previewPaths.clear();
      for (const path of paths)
        for (const listener of this.listeners) listener(path);
      // Obsidian reuses unchanged blocks after edits, including their old section
      // context. Rebuild these blocks so full-document citation order and paper
      // preferences cannot come from a previous revision of the manuscript.
      for (const leaf of this.plugin.app.workspace.getLeavesOfType(
        "markdown",
      )) {
        const view = leaf.view;
        if (
          view instanceof MarkdownView &&
          view.getMode() === "preview" &&
          view.file &&
          paths.has(view.file.path)
        )
          view.previewMode.rerender(true);
      }
    }, 200);
  }
  onunload(): void {
    if (this.invalidationTimer !== null)
      window.clearTimeout(this.invalidationTimer);
    this.invalidationTimer = null;
    if (this.previewTimer !== null) window.clearTimeout(this.previewTimer);
    this.previewPaths.clear();
    this.revision++;
    this.results.clear();
    this.refs = null;
    this.formatters.clear();
    this.listeners.clear();
  }
  subscribe(callback: (path?: string) => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }
  invalidate(): void {
    this.knownKeys = null;
    this.intent.clear();
    this.keyRead = null;
    this.revision++;
    this.refs = null;
    // Formatters are keyed by reference content, style and locale. Unchanged
    // reference data can reuse its engine after an unrelated metadata event.
    this.results.clear();
    for (const listener of this.listeners) listener();
  }
  preferences(
    path: string,
    text?: string,
  ): { style: string; language: string } {
    const file = this.plugin.app.vault.getAbstractFileByPath(path);
    let fm =
      file instanceof TFile
        ? this.plugin.app.metadataCache.getFileCache(file)?.frontmatter
        : null;
    if (text !== undefined) {
      const match =
        /^(?:\uFEFF)?---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)(?:\r?\n|$)/.exec(
          text,
        );
      const parsed: unknown = match ? parseYaml(match[1]) : null;
      fm =
        parsed && typeof parsed === "object" && !Array.isArray(parsed)
          ? parsed
          : null;
    }
    return {
      style:
        typeof fm?.stratum_citation_style === "string"
          ? fm.stratum_citation_style
          : this.plugin.settings.citationStyle,
      language:
        typeof fm?.stratum_citation_language === "string"
          ? fm.stratum_citation_language
          : this.plugin.settings.citationLanguage,
    };
  }
  private async references(): Promise<(key: string) => CitationResolution> {
    const data = await loadReferenceStore(this.plugin.app);
    const entries = buildLiteratureNoteEntries(this.plugin);
    this.managed = new Set(entries.map((entry) => entry.file.path));
    const file = this.plugin.app.vault.getAbstractFileByPath("stratum.bib");
    const bindings = readBibliographyBindings(
      file instanceof TFile ? await this.plugin.app.vault.read(file) : "",
    );
    this.knownKeys = new Set([
      ...entries.map((entry) => buildCitekey(entry)),
      ...bindings.map((binding) => binding.key),
    ]);
    return citationResolver(entries, bindings, data);
  }
  async diagnose(keys: string[]): Promise<CitationResolution[]> {
    if (this.plugin.isUnloaded) throw new Error("Stratum is unloaded.");
    const revision = this.revision;
    const pending = (this.refs ??= this.references());
    try {
      const resolve = await pending;
      if (revision !== this.revision)
        throw new Error("Citation data changed. Retry after sync completes.");
      return keys.map(resolve);
    } catch (error) {
      // A failed disk read must not poison subsequent recovery attempts.
      // Do not clear a newer read started after invalidation.
      if (this.refs === pending) this.refs = null;
      if (revision !== this.revision)
        throw new Error("Citation data changed. Retry after sync completes.");
      throw error;
    }
  }

  async format(text: string, path: string): Promise<FormattedDocument> {
    if (this.plugin.isUnloaded) throw new Error("Stratum is unloaded.");
    const revision = this.revision;
    const old = this.results.get(path);
    if (old?.text === text && old.revision === this.revision) return old.result;
    const { style, language } = this.preferences(path, text);
    const xml = cachedStyle(this.plugin, style);
    const keys = [
      ...new Set(
        citationAuthoringDocument(text).citations.flatMap((citation) =>
          citation.draft.items.map((item) => item.key),
        ),
      ),
    ];
    const result = this.diagnose(keys).then(async (resolutions) => {
      if (revision !== this.revision)
        throw new Error("Citation data changed. Retry after sync completes.");
      if (!xml)
        throw new Error(
          "This citation style is not available locally. Select it in Stratum settings to download it.",
        );
      const refs = new Map<string, CslItem>();
      const problems: string[] = [];
      for (const resolution of resolutions) {
        if (resolution.problem) {
          const reason = {
            "unknown-key": "Citation key not found",
            "conflicting-key": "Citation key has conflicting ownership",
            "missing-data": "Citation data is missing",
          }[resolution.problem];
          problems.push(
            `${reason} for @${resolution.key}. Open Sources for recovery actions.`,
          );
          continue;
        }
        refs.set(resolution.key, resolution.reference!);
      }
      const key = JSON.stringify([
        xml,
        language,
        cachedLocales(this.plugin),
        [...refs],
      ]);
      let formatter = this.formatters.get(key);
      if (!formatter) {
        const { createCitationFormatter } = await import("./citation-format");
        formatter = createCitationFormatter(
          xml,
          language,
          cachedLocales(this.plugin),
          refs,
        );
        if (this.formatters.size >= 3) this.formatters.clear();
        this.formatters.set(key, formatter);
      }
      try {
        const output = formatter(text);
        const explicit = new Set(
          citationAuthoringDocument(text)
            .citations.filter(
              (c) => !c.draft.narrative || this.knownKey(c.draft.items[0].key),
            )
            .flatMap((c) => c.draft.items.map((item) => item.key)),
        );
        return {
          ...output,
          model: {
            ...output.model,
            problems: [
              ...new Set([
                ...output.model.problems,
                ...problems.filter((problem) =>
                  [...explicit].some((key) => problem.includes(`@${key}.`)),
                ),
              ]),
            ],
          },
        };
      } catch (error) {
        this.formatters.delete(key);
        throw error;
      }
    });
    if (this.results.size > 12) this.results.clear();
    this.results.set(path, { text, revision: this.revision, result });
    try {
      return await result;
    } catch (error) {
      if (this.results.get(path)?.result === result) this.results.delete(path);
      throw error;
    }
  }
}
