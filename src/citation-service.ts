import {
  Component,
  MarkdownView,
  TFile,
  parseYaml,
  type TAbstractFile,
} from "obsidian";
import type StratumPlugin from "./plugin";
import { buildLiteratureNoteEntries } from "./library-search-modal";
import { buildCitekey } from "./bibtex-format";
import { readBibliographyBindings } from "./document-sources";
import { loadReferenceStore, REFERENCE_FILE } from "./citation-reference-store";
import { cachedLocales, cachedStyle } from "./citation-styles";
import {
  createCitationFormatter,
  type FormattedDocument,
} from "./citation-format";
import type { CslItem } from "./csl-data";
export class CitationService extends Component {
  private previewTimer: number | null = null;
  private previewPaths = new Set<string>();
  private revision = 0;
  private formatters = new Map<string, (text: string) => FormattedDocument>();
  private managed = new Set<string>();
  private refs: Promise<Map<string, CslItem>> | null = null;
  private results = new Map<
    string,
    { text: string; revision: number; result: Promise<FormattedDocument> }
  >();
  private listeners = new Set<() => void>();
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
      if (managed) this.managed.add(file.path);
      if (
        file.path === "stratum.bib" ||
        file.path === REFERENCE_FILE ||
        managed ||
        this.managed.has(file.path)
      )
        this.invalidate();
      else if (file.path.endsWith(".md")) {
        this.refreshReadingView(file.path);
        this.results.delete(file.path);
        for (const listener of this.listeners) listener();
      }
    };
    this.registerEvent(this.plugin.app.vault.on("create", changed));
    this.registerEvent(this.plugin.app.vault.on("modify", changed));
    this.registerEvent(this.plugin.app.vault.on("delete", changed));
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
        changed(file);
      }),
    );
  }
  private refreshReadingView(path: string): void {
    this.previewPaths.add(path);
    if (this.previewTimer !== null) window.clearTimeout(this.previewTimer);
    this.previewTimer = window.setTimeout(() => {
      this.previewTimer = null;
      const paths = new Set(this.previewPaths);
      this.previewPaths.clear();
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
    if (this.previewTimer !== null) window.clearTimeout(this.previewTimer);
    this.previewPaths.clear();
    this.revision++;
    this.results.clear();
    this.refs = null;
    this.formatters.clear();
    this.listeners.clear();
  }
  subscribe(callback: () => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }
  invalidate(): void {
    this.revision++;
    this.refs = null;
    this.formatters.clear();
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
  private async references(): Promise<Map<string, CslItem>> {
    const data = await loadReferenceStore(this.plugin.app);
    const entries = buildLiteratureNoteEntries(this.plugin);
    this.managed = new Set(entries.map((entry) => entry.file.path));
    const file = this.plugin.app.vault.getAbstractFileByPath("stratum.bib");
    const bindings = readBibliographyBindings(
      file instanceof TFile ? await this.plugin.app.vault.read(file) : "",
    );
    const owners = new Map<string, Set<string>>();
    const add = (key: string, id: string) => {
      const ids = owners.get(key) ?? new Set<string>();
      ids.add(id);
      owners.set(key, ids);
    };
    for (const binding of bindings) add(binding.key, binding.identity);
    for (const entry of entries)
      if (entry.identity) add(buildCitekey(entry), entry.identity);
    const byIdentity = new Map(data.map((item) => [item.id, item]));
    const result = new Map<string, CslItem>();
    for (const [key, ids] of owners)
      if (ids.size === 1) {
        const item = byIdentity.get([...ids][0]);
        if (item) result.set(key, item);
      }
    return result;
  }
  async format(text: string, path: string): Promise<FormattedDocument> {
    if (this.plugin.isUnloaded) throw new Error("Stratum is unloaded.");
    const revision = this.revision;
    const old = this.results.get(path);
    if (old?.text === text && old.revision === this.revision) return old.result;
    const { style, language } = this.preferences(path, text);
    const xml = cachedStyle(this.plugin, style);
    const result = (this.refs ??= this.references()).then((refs) => {
      if (revision !== this.revision) return this.format(text, path);
      if (!xml)
        throw new Error(
          "This citation style is not available locally. Select it in Stratum settings to download it.",
        );
      const key = JSON.stringify([style, language]);
      let formatter = this.formatters.get(key);
      if (!formatter) {
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
        return formatter(text);
      } catch (error) {
        this.formatters.delete(key);
        throw error;
      }
    });
    if (this.results.size > 12) this.results.clear();
    this.results.set(path, { text, revision: this.revision, result });
    return result;
  }
}
