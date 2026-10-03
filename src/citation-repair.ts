import {
  MarkdownView,
  Modal,
  Setting,
  type Editor,
  type TFile,
} from "obsidian";
import type StratumPlugin from "./plugin";
import {
  buildLiteratureNoteEntries,
  LiteratureNoteSearchModal,
  type LiteratureNoteEntry,
} from "./library-search-modal";
import {
  citationEntriesSignature,
  readCitationBibliography,
  citationKeyIndex,
} from "./citation-keys";
import { planCitationRepair } from "./citation-repair-plan";
import { commitCitationRepair } from "./citation-repair-write";
import { parseSourceOccurrences } from "./source-occurrences";

const sessions = new WeakMap<StratumPlugin, Set<CitationRepair>>();
export async function openCitationRepair(
  plugin: StratumPlugin,
  file: TFile,
  editor: Editor,
  oldKey: string,
): Promise<void> {
  const text = editor.getValue();
  const bibliography = await readCitationBibliography(plugin.app);
  if (plugin.isUnloaded || editor.getValue() !== text) return;
  const entries = buildLiteratureNoteEntries(plugin);
  const modal = new CitationRepair(
    plugin,
    file,
    editor,
    text,
    bibliography,
    oldKey,
    entries,
  );
  let active = sessions.get(plugin);
  if (!active) {
    active = new Set();
    sessions.set(plugin, active);
    const tracked = active;
    plugin.register(() => {
      for (const repair of tracked) repair.close();
      tracked.clear();
    });
  }
  const tracked = active;
  modal.onDismiss = () => tracked.delete(modal);
  tracked.add(modal);
  modal.open();
}

class CitationRepair extends Modal {
  onDismiss?: () => void;
  private active = false;
  private entriesSignature: string;
  private busy = false;
  private entry?: LiteratureNoteEntry;
  private occurrenceScope: number | "all" = 0;
  private picker?: LiteratureNoteSearchModal;
  constructor(
    private plugin: StratumPlugin,
    private file: TFile,
    private editor: Editor,
    private text: string,
    private bibliography: string,
    private oldKey: string,
    private entries: LiteratureNoteEntry[],
  ) {
    super(plugin.app);
    this.entriesSignature = citationEntriesSignature(entries);
  }
  onOpen(): void {
    this.active = true;
    this.render();
  }
  onClose(): void {
    this.active = false;
    this.picker?.close();
    this.onDismiss?.();
    this.contentEl.empty();
  }
  private unchanged(): boolean {
    return (
      this.active &&
      !this.plugin.isUnloaded &&
      this.editor.getValue() === this.text &&
      this.app.workspace
        .getLeavesOfType("markdown")
        .some(
          (leaf) =>
            leaf.view instanceof MarkdownView &&
            leaf.view.file === this.file &&
            leaf.view.editor === this.editor,
        )
    );
  }
  private render(): void {
    const el = this.contentEl;
    el.empty();
    this.setTitle("Repair citation");
    el.createEl("p", {
      text: `Repair @${this.oldKey} in ${this.file.basename}. Other papers and existing bibliography entries will not be changed.`,
    });
    new Setting(el)
      .setName("Intended source")
      .setDesc(
        this.entry
          ? `${this.entry.title} — ${this.entry.identity}`
          : "Choose the source this citation should refer to.",
      )
      .addButton((b) =>
        b
          .setButtonText(this.entry ? "Change source" : "Choose source")
          .onClick(() => {
            const index = citationKeyIndex(this.entries, this.bibliography);
            this.picker = new LiteratureNoteSearchModal(
              this.app,
              this.entries,
              (entry) => {
                if (!this.active || this.busy) return;
                this.entry = entry;
                this.render();
              },
              index.label,
            );
            this.picker.open();
          }),
      );
    const occurrences = parseSourceOccurrences(this.text).filter(
      (o) => o.kind === "citation" && o.target === this.oldKey,
    );
    new Setting(el).setName("Occurrences to repair").addDropdown((d) => {
      occurrences.forEach((o, i) => {
        d.addOption(String(i), `${i + 1}: ${o.excerpt}`);
      });
      if (occurrences.length > 1)
        d.addOption(
          "all",
          `All ${occurrences.length} occurrences in this paper`,
        );
      d.setValue(String(this.occurrenceScope)).onChange((value) => {
        this.occurrenceScope = value === "all" ? "all" : Number(value);
        this.render();
      });
    });
    let plan: ReturnType<typeof planCitationRepair> | undefined;
    const status = el.createDiv({
      attr: { role: "status", "aria-live": "polite" },
    });
    try {
      if (this.entry) {
        plan = planCitationRepair(
          this.text,
          this.oldKey,
          this.entry,
          this.entries,
          this.bibliography,
          this.occurrenceScope,
        );
        el.createEl("p", {
          text: `Replacement key: @${plan.key}. ${plan.edits.length} ${plan.edits.length === 1 ? "occurrence" : "occurrences"}.`,
        });
        for (const edit of plan.edits) {
          el.createEl("p", { text: edit.excerpt });
          el.createEl("pre", { text: `${edit.before} → ${edit.after}` });
        }
        el.createEl("p", {
          text: "Only citation keys change. Locators and prose stay intact. One undo restores the paper. If saving is interrupted, an unused bibliography entry may remain.",
        });
      }
    } catch (error) {
      status.setText(
        error instanceof Error ? error.message : "Cannot prepare this repair.",
      );
    }
    new Setting(el)
      .addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((b) =>
        b
          .setButtonText("Apply repair")
          .setCta()
          .setDisabled(!plan)
          .onClick(() => {
            if (!plan || !this.entry || this.busy) return;
            this.busy = true;
            const confirmed = plan,
              entry = this.entry;
            el.querySelectorAll<HTMLButtonElement | HTMLSelectElement>(
              "button, select",
            ).forEach((control) => (control.disabled = true));
            const valid = () =>
              this.unchanged() &&
              citationEntriesSignature(
                buildLiteratureNoteEntries(this.plugin),
              ) === this.entriesSignature;
            void (async () => {
              if (!valid())
                throw new Error(
                  "The paper or sources changed. Reopen the repair preview.",
                );
              // Rebuild against current ownership before any write.
              const current = await readCitationBibliography(this.app);
              if (current !== this.bibliography)
                throw new Error(
                  "The bibliography changed. Reopen the repair preview.",
                );
              const checked = planCitationRepair(
                this.text,
                this.oldKey,
                entry,
                this.entries,
                current,
                this.occurrenceScope,
              );
              if (JSON.stringify(checked) !== JSON.stringify(confirmed))
                throw new Error("The repair changed. Reopen the preview.");
              await commitCitationRepair(
                this.app,
                this.editor,
                current,
                confirmed,
                valid,
              );
              this.plugin.citations.invalidate();
              this.editor.focus();
              this.close();
            })().catch((error: unknown) => {
              if (this.active) {
                this.busy = false;
                this.render();
                this.contentEl.createEl("p", {
                  text:
                    error instanceof Error
                      ? error.message
                      : "Repair failed. No manuscript edits were applied.",
                  attr: { role: "alert" },
                });
              }
            });
          }),
      );
  }
}
