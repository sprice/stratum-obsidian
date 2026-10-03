import { FuzzySuggestModal, Modal, Notice, Setting, TFile } from "obsidian";
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
  readStyle,
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
export class CitationPreferences extends Modal {
  private selected: string;
  private language: string;
  private active = false;
  private busy = false;
  private picker: StylePicker | null = null;
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
  }
  onOpen(): void {
    this.active = true;
    this.render();
  }
  onClose(): void {
    this.active = false;
    this.picker?.close();
    this.contentEl.empty();
  }
  private render(): void {
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
        button
          .setButtonText("Choose style")
          .setDisabled(this.busy)
          .onClick(() => {
            const available = [
              ...bundledStyles,
              ...Object.keys(this.plugin.settings.citationStyles)
                .filter((id) => !bundledStyles.some((s) => s.id === id))
                .map((id) => ({
                  id,
                  title: styleTitle(this.plugin, id),
                })),
            ];
            this.showPicker(available, (style) => {
              if (this.active) {
                this.selected = style.id;
                this.render();
              }
            });
          }),
      )
      .addButton((button) =>
        button
          .setButtonText("Find more styles")
          .setDisabled(this.busy)
          .onClick(async () => {
            button.setDisabled(true);
            try {
              const styles = await styleCatalog();
              if (this.active)
                this.showPicker(styles, (style) => {
                  if (this.active) {
                    this.selected = style.id;
                    this.render();
                  }
                });
            } catch (error) {
              new Notice(
                error instanceof Error
                  ? error.message
                  : "Could not load styles.",
              );
            } finally {
              button.setDisabled(false);
            }
          }),
      );
    new Setting(el)
      .setName("Language")
      .setDesc(
        "Used for labels and reference formatting; some styles specify their own language.",
      )
      .addDropdown((drop) =>
        drop
          .addOptions(languages)
          .setValue(this.language)
          .setDisabled(this.busy)
          .onChange((value) => {
            this.language = value;
            this.render();
          }),
      );
    new Setting(el)
      .setName("Import a custom style")
      .setDesc("Select a citation style file already in your vault.")
      .addButton((button) =>
        button
          .setButtonText("Choose style file")
          .setDisabled(this.busy)
          .onClick(() => {
            const files = this.app.vault
              .getFiles()
              .filter((file) => file.extension === "csl");
            this.showPicker(
              files.map((file) => ({ id: file.path, title: file.path })),
              (style) => {
                void this.importCustom(style.id);
              },
            );
          }),
      );
    el.createEl("p", {
      cls: "setting-item-description",
      text: "More styles are downloaded from Zotero's style repository. Selected styles are saved for offline use.",
    });
    const credits = el.createEl("p", { cls: "setting-item-description" });
    credits.appendText("Citation formatting: ");
    credits.createEl("a", {
      text: "Citeproc-js",
      href: "https://github.com/Juris-M/citeproc-js",
    });
    credits.appendText(
      " by Frank Bennett. Styles: Citation Style Language project.",
    );
    const preview = el.createDiv({
      cls: "stratum-citation-preview stratum-reference-output",
    });
    preview.createEl("strong", { text: "Example" });
    if (!xml)
      preview.createEl("p", {
        text: "Apply to download this style and see formatted citations in your paper.",
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
          text: "Apply to load the resources needed for this preview.",
        });
      }
    const actions = new Setting(el);
    if (this.file)
      actions.addButton((button) =>
        button
          .setButtonText("Use default style")
          .setDisabled(this.busy)
          .onClick(async () => {
            this.busy = true;
            this.render();
            try {
              await this.app.fileManager.processFrontMatter(
                this.file!,
                (fm: Record<string, unknown>) => {
                  delete fm.stratum_citation_style;
                  delete fm.stratum_citation_language;
                },
              );
              this.plugin.citations.invalidate();
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
      button
        .setButtonText("Apply")
        .setCta()
        .setDisabled(this.busy)
        .onClick(() => {
          void this.apply();
        }),
    );
  }
  private async importCustom(path: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return;
    try {
      const xml = await this.app.vault.read(file);
      readStyle(xml);
      const id = `custom-${Date.now()}`;
      await prepareStyle(this.plugin, id, this.language, xml);
      if (this.active) {
        this.selected = id;
        this.render();
      }
    } catch (error) {
      new Notice(
        error instanceof Error ? error.message : "Could not import style.",
      );
    }
  }
  private async apply(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    const id = this.selected,
      language = this.language;
    this.render();
    try {
      await prepareStyle(this.plugin, id, language);
      if (!this.active || this.plugin.isUnloaded) return;
      if (this.file)
        await this.app.fileManager.processFrontMatter(
          this.file,
          (fm: Record<string, unknown>) => {
            fm.stratum_citation_style = id;
            fm.stratum_citation_language = language;
          },
        );
      else {
        const previousStyle = this.plugin.settings.citationStyle;
        const previousLanguage = this.plugin.settings.citationLanguage;
        this.plugin.settings.citationStyle = id;
        this.plugin.settings.citationLanguage = language;
        try {
          await this.plugin.saveSettings();
        } catch (error) {
          this.plugin.settings.citationStyle = previousStyle;
          this.plugin.settings.citationLanguage = previousLanguage;
          throw error;
        }
      }
      this.plugin.citations.invalidate();
      this.plugin.refreshSettingTab();
      this.close();
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
