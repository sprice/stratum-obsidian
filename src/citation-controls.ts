import { styleStratumComponent } from "./ui-controls";
import { openChecklist, type ChecklistItem } from "./settings-checklist";
import {
  availableCitationStyles,
  setCitationStyleAvailable,
  setDefaultCitationStyle,
  changeCitationPreferences,
} from "./citation-style-collection";
import {
  resetNoteCitationPreferences,
  setNoteCitationStyle,
} from "./citation-style-choice";
import {
  FuzzySuggestModal,
  Modal,
  Notice,
  Setting,
  type TFile,
} from "obsidian";
import { formatCitationDocument } from "./citation-format";
import { renderCsl } from "./citation-render";
import type StratumPlugin from "./plugin";
import {
  bundledStyles,
  cachedLocales,
  styleTitle,
  cachedStyle,
  languages,
  prepareStyle,
  styleCatalog,
  type CitationStyle,
} from "./citation-styles";
class StylePicker extends FuzzySuggestModal<CitationStyle> {
  constructor(
    plugin: StratumPlugin,
    private styles: CitationStyle[],
    private choose: (style: CitationStyle) => void,
  ) {
    super(plugin.app);
    this.setPlaceholder("Search styles or journals");
  }
  getItems(): CitationStyle[] {
    return this.styles;
  }
  getItemText(item: CitationStyle): string {
    return item.title;
  }
  onChooseItem(item: CitationStyle): void {
    this.choose(item);
  }
}
const openPreferences = new WeakMap<StratumPlugin, Set<CitationPreferences>>();
export class CitationPreferences extends Modal {
  private selected: string;
  private language: string;
  private active = false;
  private busy = false;
  private picker: StylePicker | null = null;
  private closeChooser?: () => void;
  private showPicker(
    styles: CitationStyle[],
    choose: (style: CitationStyle) => void,
  ): void {
    this.picker?.close();
    this.picker = new StylePicker(this.plugin, styles, (style) => {
      if (this.active) choose(style);
    });
    this.picker.open();
  }
  constructor(
    private plugin: StratumPlugin,
    private file: TFile | null = null,
  ) {
    super(plugin.app);
    const prefs = file
      ? plugin.citations.preferences(file.path)
      : {
          style: plugin.settings.citationStyle,
          language: plugin.settings.citationLanguage,
        };
    this.selected = prefs.style;
    this.language = prefs.language;
    let active = openPreferences.get(plugin);
    if (!active) {
      active = new Set();
      openPreferences.set(plugin, active);
      const tracked = active;
      plugin.register(() => {
        for (const modal of tracked) modal.close();
        tracked.clear();
      });
    }
  }
  onOpen(): void {
    this.active = true;
    openPreferences.get(this.plugin)!.add(this);
    this.render();
  }
  onClose(): void {
    this.active = false;
    openPreferences.get(this.plugin)?.delete(this);
    this.picker?.close();
    this.closeChooser?.();
    this.contentEl.empty();
  }
  private render(): void {
    this.closeChooser?.();
    const el = this.contentEl;
    el.empty();
    this.setTitle(
      this.file ? "Citation style for this paper" : "Default citation style",
    );
    el.createEl("p", {
      text: this.file
        ? "This paper can use its own style or follow the Stratum default."
        : "Applies to all papers without a style override. Your citation keys and manuscript text stay unchanged.",
    });
    const xml = cachedStyle(this.plugin, this.selected);
    const title = styleTitle(this.plugin, this.selected);
    new Setting(el)
      .setName("Citation style")
      .setDesc(title)
      .addButton((button) =>
        styleStratumComponent(button)
          .setButtonText(this.file ? "Choose style" : "Choose default style")
          .setDisabled(this.busy)
          .onClick(() => {
            this.showPicker(availableCitationStyles(this.plugin), (style) => {
              void this.chooseStyle(style.id);
            });
          }),
      )
      .addButton((button) =>
        styleStratumComponent(button)
          .setButtonText("Choose available citation styles")
          .setDisabled(this.busy)
          .onClick(() => {
            const wasOpen =
              button.buttonEl.getAttribute("aria-expanded") === "true";
            this.closeChooser?.();
            if (wasOpen) return;
            const enabled = new Set(
              availableCitationStyles(this.plugin).map(({ id }) => id),
            );
            const item = (style: CitationStyle): ChecklistItem => ({
              id: style.id,
              label: style.title,
              checked: enabled.has(style.id),
              disabled: style.id === this.plugin.settings.citationStyle,
              badge:
                style.id === this.plugin.settings.citationStyle
                  ? "Default"
                  : undefined,
            });
            const local = new Map(
              [
                ...bundledStyles,
                ...Object.keys(this.plugin.settings.citationStyles).map(
                  (id) => ({ id, title: styleTitle(this.plugin, id) }),
                ),
                ...availableCitationStyles(this.plugin),
              ].map((style) => [style.id, style]),
            );
            button.buttonEl.setAttribute("aria-haspopup", "dialog");
            button.buttonEl.addClass("stratum-tab-chooser-trigger");
            this.closeChooser = openChecklist(button.buttonEl, {
              title: "Choose available citation styles",
              searchable: true,
              keyboard: { keymap: this.app.keymap, parent: this.scope },
              items: Array.from(local.values(), item),
              loadItems: async () => {
                const catalog = await styleCatalog();
                const all = new Map(
                  [...catalog, ...local.values()].map((style) => [
                    style.id,
                    style,
                  ]),
                );
                enabled.clear();
                for (const { id } of availableCitationStyles(this.plugin))
                  enabled.add(id);
                return Array.from(all.values(), item);
              },
              onChange: (id, checked) =>
                setCitationStyleAvailable(this.plugin, id, checked),
            });
          }),
      );
    new Setting(el)
      .setName("Language")
      .setDesc(
        "Used for labels and reference formatting; some styles specify their own language.",
      )
      .addDropdown((drop) =>
        styleStratumComponent(drop)
          .addOptions(languages)
          .setValue(this.language)
          .setDisabled(this.busy)
          .onChange((value) => {
            this.language = value;
            this.render();
          }),
      );
    new Setting(el)
      .setName("Unused custom styles")
      .setDesc("Remove imported styles that no paper uses.")
      .addButton((button) =>
        styleStratumComponent(button)
          .setButtonText("Remove unused styles")
          .setDisabled(this.busy)
          .onClick(async () => {
            if (!this.active || this.busy || this.plugin.isUnloaded) return;
            this.busy = true;
            button.setDisabled(true);
            try {
              await changeCitationPreferences(this.plugin, async () => {
                const used = new Set([
                  this.selected,
                  this.plugin.settings.citationStyle,
                  ...availableCitationStyles(this.plugin).map(({ id }) => id),
                ]);
                for (const file of this.app.vault.getMarkdownFiles()) {
                  const cache = this.app.metadataCache.getFileCache(file);
                  if (!cache) {
                    this.busy = false;
                    if (this.active) this.render();
                    new Notice(
                      "Wait for Obsidian to index your notes before removing styles.",
                    );
                    return;
                  }
                  const style: unknown =
                    cache.frontmatter?.stratum_citation_style;
                  if (typeof style === "string") used.add(style);
                }
                const previous = this.plugin.settings.citationStyles;
                this.plugin.settings.citationStyles = Object.fromEntries(
                  Object.entries(previous).filter(
                    ([id]) => !id.startsWith("custom-") || used.has(id),
                  ),
                );
                try {
                  const { saveCitationResources } =
                    await import("./citation-resources");
                  await saveCitationResources(this.plugin);
                  new Notice("Unused custom citation styles removed.");
                } catch {
                  this.plugin.settings.citationStyles = previous;
                  throw new Error("Could not remove unused styles.");
                }
              });
            } catch (error) {
              new Notice(
                error instanceof Error
                  ? error.message
                  : "Could not remove unused styles.",
              );
            } finally {
              this.busy = false;
              if (this.active) this.render();
            }
          }),
      );
    const preview = el.createDiv({
      cls: "stratum-citation-preview stratum-reference-output",
    });
    preview.createEl("strong", { text: "Example" });
    if (!xml)
      preview.createEl("p", {
        text: "Choose an available style to load citation resources.",
      });
    else
      try {
        const example = formatCitationDocument(
          "A finding [@example, p. 42].",
          xml,
          this.language,
          cachedLocales(this.plugin),
          new Map([
            [
              "example",
              {
                id: "example",
                type: "book",
                title: "Research in practice",
                author: [{ family: "Smith", given: "Alex" }],
                issued: { "date-parts": [[2024]] },
                publisher: "Example Press",
              },
            ],
          ]),
        );
        const citation = preview.createEl("p");
        citation.appendText(
          example.noteStyle ? "Citation note: " : "A finding ",
        );
        renderCsl(citation, example.citations[0]);
        renderCsl(preview, example.bibliography);
      } catch {
        preview.createEl("p", {
          text: "Apply language to load the resources needed for this preview.",
        });
      }
    const actions = new Setting(el);
    if (this.file)
      actions.addButton((button) =>
        styleStratumComponent(button)
          .setButtonText("Use default style")
          .setDisabled(this.busy)
          .onClick(async () => {
            if (!this.active || this.busy || this.plugin.isUnloaded) return;
            this.busy = true;
            this.render();
            try {
              await resetNoteCitationPreferences(this.plugin, this.file!);
              this.close();
            } catch {
              new Notice(
                "Could not remove the paper's citation style override.",
              );
            } finally {
              this.busy = false;
              if (this.active) this.render();
            }
          }),
      );
    actions.addButton((button) =>
      styleStratumComponent(button)
        .setButtonText("Apply language")
        .setCta()
        .setDisabled(this.busy)
        .onClick(() => {
          void this.apply();
        }),
    );
  }
  private async chooseStyle(id: string): Promise<void> {
    if (!this.active || this.busy || this.plugin.isUnloaded) return;
    this.busy = true;
    this.render();
    try {
      if (this.file) {
        const language = this.plugin.citations.preferences(
          this.file.path,
        ).language;
        await setNoteCitationStyle(this.plugin, this.file, id, language);
      } else await setDefaultCitationStyle(this.plugin, id);
      if (this.plugin.isUnloaded) return;
      this.selected = id;
    } catch (error) {
      new Notice(
        error instanceof Error
          ? error.message
          : "Could not change citation style.",
      );
    } finally {
      this.busy = false;
      if (this.active) this.render();
    }
  }
  private async apply(): Promise<void> {
    if (!this.active || this.busy || this.plugin.isUnloaded) return;
    this.busy = true;
    const language = this.language;
    this.render();
    try {
      await changeCitationPreferences(this.plugin, async () => {
        const id = this.file
          ? this.plugin.citations.preferences(
              this.file.path,
              await this.app.vault.cachedRead(this.file),
            ).style
          : this.plugin.settings.citationStyle;
        await prepareStyle(this.plugin, id, language);
        if (!this.active || this.plugin.isUnloaded) return;
        if (this.file)
          await this.app.fileManager.processFrontMatter(
            this.file,
            (fm: Record<string, unknown>) => {
              fm.stratum_citation_language = language;
            },
          );
        else {
          const previousLanguage = this.plugin.settings.citationLanguage;
          this.plugin.settings.citationLanguage = language;
          try {
            await this.plugin.saveSettings();
          } catch (error) {
            this.plugin.settings.citationLanguage = previousLanguage;
            throw error;
          }
        }
        this.plugin.citations.invalidate();
        this.plugin.refreshSettingTab();
        this.close();
      });
    } catch (error) {
      new Notice(
        error instanceof Error
          ? error.message
          : "Could not change citation style.",
      );
    } finally {
      this.busy = false;
      if (this.active) this.render();
    }
  }
}
