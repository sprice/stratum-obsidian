import type { TFile, ToggleComponent } from "obsidian";
import type { PublishController } from "./publish-controller";
import type { PublicationEditor, PropertyDraft } from "./publication-editor";
import {
  PUBLICATION_PROPERTIES,
  publicationPropertyRevision,
  publicationYaml,
  type PublicationPropertyKey,
  type PublicationPropertyOperation,
} from "./publication-metadata";
import {
  createStratumButton,
  createStratumField,
  createStratumInput,
  createStratumSelect,
  createStratumTextarea,
  createStratumToggle,
} from "./ui-controls";
import type { PublishOptions } from "./publish-options";
const flags: Partial<Record<PublicationPropertyKey, keyof PublishOptions>> = {
  authors: "showAuthors",
  affiliations: "showAffiliations",
  date: "showDate",
  keywords: "showKeywords",
};
const list = (key: PublicationPropertyKey) =>
  ["authors", "affiliations", "keywords"].includes(key);
const display = (value: unknown): string =>
  Array.isArray(value)
    ? value.filter((item) => typeof item === "string").join("\n")
    : typeof value === "string"
      ? value
      : "";

/** Root publishing fields share the in-note editor's guarded transactions and draft session. */
export class PublicationPropertyControls {
  path: string;
  private cleanup: () => void;
  private active?: {
    input: HTMLInputElement | HTMLTextAreaElement;
    key: PublicationPropertyKey;
    draft: PropertyDraft;
    original: string;
  };
  private alive = true;
  private signature = "";
  private structure = "";
  private refreshing = false;
  private toggleRevision = 0;
  private toggles = new Map<keyof PublishOptions, ToggleComponent>();
  private pending = new Map<
    keyof PublishOptions,
    { value: boolean; revision: number }
  >();
  constructor(
    private container: HTMLElement,
    private publish: PublishController,
    private service: PublicationEditor,
    private file: TFile,
    private changeLayout: (patch: Partial<PublishOptions>) => Promise<void> = (
      patch,
    ) => publish.updateLayout(patch),
  ) {
    this.path = file.path;
    this.cleanup = service.registerPropertyForm(this);
    this.refresh();
  }
  capture(): void {
    if (!this.alive || !this.active) return;
    const { input, key, draft } = this.active;
    if (
      input.value === this.active.original &&
      !this.service.session(this.path).properties.has(key)
    )
      return;
    const value = list(key)
      ? input.value
          .split(/\r?\n/)
          .map((value) => value.trim())
          .filter(Boolean)
      : input.value;
    if (JSON.stringify(value) !== JSON.stringify(draft.operation.value)) {
      draft.operation.value = value;
      draft.operation.remove = false;
      this.service.session(this.path).properties.set(key, draft);
    }
  }
  destroy(): void {
    this.capture();
    this.alive = false;
    this.cleanup();
    this.active = undefined;
  }
  private properties(): Record<string, unknown> {
    const view = this.service.editableView(this.file);
    if (!view)
      throw new Error("Open this note for editing to change its properties.");
    return publicationYaml(view.state.doc.toString()).properties;
  }
  private draft(operation: PublicationPropertyOperation): PropertyDraft {
    return {
      operation,
      revision: publicationPropertyRevision(this.properties(), operation.key),
      conflict: "",
      file: this.file,
      ctime: this.file.stat.ctime,
    };
  }
  private commit(operation: PublicationPropertyOperation): void {
    if (!this.alive || this.publish.busy) return;
    if (!this.service.flush(this.path)) return;
    this.service.commitProperty(
      this.path,
      operation.key,
      this.draft(operation),
    );
  }
  private inclusion(
    parent: HTMLElement,
    key: "authors" | "affiliations" | "date" | "keywords",
  ): void {
    const flag = flags[key]!;
    const toggle = createStratumToggle(parent, {
      label: `Include ${key} in PDF`,
      value: this.pending.get(flag)?.value ?? !!this.publish.layout[flag],
      onChange: (value) => {
        if (this.refreshing || !this.alive || this.publish.busy) return;
        const revision = ++this.toggleRevision;
        this.pending.set(flag, { value, revision });
        void this.changeLayout({ [flag]: value })
          .catch(() => {})
          .finally(() => {
            if (this.pending.get(flag)?.revision === revision)
              this.pending.delete(flag);
            this.refresh();
          });
      },
    });
    this.toggles.set(flag, toggle);
  }
  private syncToggles(): void {
    this.refreshing = true;
    try {
      for (const [key, toggle] of this.toggles) {
        toggle.setValue(
          this.pending.get(key)?.value ?? !!this.publish.layout[key],
        );
        toggle.setDisabled(
          this.publish.busy ||
            (this.publish.preferencesSaving &&
              !toggle.toggleEl.contains(document.activeElement)),
        );
      }
    } finally {
      this.refreshing = false;
    }
  }
  refresh(): void {
    if (!this.alive) return;
    const session = this.service.session(this.path);
    if (
      !this.publish.busy &&
      this.active &&
      this.container.contains(document.activeElement) &&
      !this.active.draft.conflict
    )
      return;
    let properties: Record<string, unknown>;
    try {
      properties = this.properties();
    } catch (error) {
      this.container.empty();
      this.container.createEl("p", {
        text:
          error instanceof Error
            ? error.message
            : "Repair the note's YAML in Source mode.",
        attr: { role: "alert" },
      });
      return;
    }
    const aastex = this.publish.selectedTemplate?.renderer === "aastex";
    const structured = !!(
      properties.stratum_publish &&
      typeof properties.stratum_publish === "object" &&
      Object.hasOwn(properties.stratum_publish, "authors")
    );
    const keys = (
      Object.keys(PUBLICATION_PROPERTIES) as PublicationPropertyKey[]
    ).filter(
      (key) =>
        (aastex
          ? key === "title"
          : !structured || !["authors", "affiliations"].includes(key)) ||
        session.properties.has(key),
    );
    const requiredTitle = this.publish.layout.titleSource === "properties";
    const visible = keys.filter(
      (key) =>
        Object.hasOwn(properties, key) ||
        (key === "title" && requiredTitle) ||
        session.properties.has(key),
    );
    const signature = JSON.stringify([
      keys.map((key) => [
        key,
        Object.hasOwn(properties, key),
        display(properties[key]),
      ]),
      [...session.properties].map(([key, draft]) => [
        key,
        draft.operation,
        draft.revision,
        draft.conflict,
      ]),
      this.publish.layout,
      this.publish.busy,
      visible,
    ]);
    if (signature === this.signature) return;
    this.signature = signature;
    const structure = JSON.stringify([
      visible,
      requiredTitle,
      structured,
      this.publish.busy,
      [...session.properties]
        .filter(([, draft]) => draft.conflict)
        .map(([key, draft]) => [
          key,
          draft.operation,
          draft.revision,
          draft.conflict,
          publicationPropertyRevision(properties, key),
        ]),
    ]);
    if (structure === this.structure) {
      for (const input of Array.from(
        this.container.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
          "input[data-property-control],textarea[data-property-control]",
        ),
      )) {
        const key = input.dataset.propertyControl as PublicationPropertyKey;
        input.value = display(
          session.properties.get(key)?.operation.value ?? properties[key],
        );
      }
      this.syncToggles();
      return;
    }
    this.structure = structure;
    this.toggles.clear();
    const focused = this.container.contains(document.activeElement)
      ? (document.activeElement as HTMLElement).dataset.propertyControl
      : undefined;
    this.container.empty();
    for (const key of visible) {
      const required = key === "title" && requiredTitle;
      const row = this.container.createDiv({
        cls: "stratum-publishing-property",
      });
      const field = createStratumField(
        row,
        PUBLICATION_PROPERTIES[key] + (required ? " · required" : ""),
      );
      const draft = session.properties.get(key);
      const options = {
        value: display(draft?.operation.value ?? properties[key]),
        attr: {
          "aria-label": PUBLICATION_PROPERTIES[key],
          "aria-required": String(required),
        },
      };
      const input = list(key)
        ? createStratumTextarea(field, options)
        : createStratumInput(field, {
            ...options,
            type: key === "date" ? "date" : "text",
          });
      input.dataset.propertyControl = key;
      input.disabled = this.publish.busy;
      input.addEventListener("focus", () => {
        if (!this.alive || !this.service.editableView(this.file)) return;
        this.active = {
          input,
          key,
          original: input.value,
          draft:
            session.properties.get(key) ??
            this.draft({
              key,
              value:
                (this.properties()[key] as string | string[]) ??
                (list(key) ? [] : ""),
            }),
        };
      });
      input.addEventListener("input", () => this.capture());
      const save = () => {
        this.capture();
        this.active = undefined;
        const pending = session.properties.get(key);
        if (pending && !pending.conflict)
          this.service.commitProperty(this.path, key, pending);
        this.refresh();
      };
      input.addEventListener("blur", save);
      input.addEventListener("keydown", (event) => {
        const keyboard = event as KeyboardEvent;
        if (
          keyboard.key === "Enter" &&
          !keyboard.isComposing &&
          (!(input instanceof HTMLTextAreaElement) ||
            keyboard.ctrlKey ||
            keyboard.metaKey)
        ) {
          event.preventDefault();
          input.blur();
          save();
        }
      });
      if (key === "title" && !required)
        row.createEl("p", {
          text: "The PDF uses the title in your document; this property is retained.",
          cls: "stratum-publish-meta",
        });
      const flag = flags[key];
      if (flag && !aastex)
        this.inclusion(
          row,
          key as "authors" | "affiliations" | "date" | "keywords",
        );
      if (draft?.conflict) {
        row.createEl("p", { text: draft.conflict, attr: { role: "alert" } });
        row.createEl("p", {
          text: `Current value: ${display(properties[key]) || "(absent or empty)"}`,
        });
        const apply = createStratumButton(row, {
          text: "Apply draft to current property",
          tooltip: "Apply draft to current property",
        });
        apply.disabled = this.publish.busy;
        apply.addEventListener("click", () => {
          draft.revision = publicationPropertyRevision(this.properties(), key);
          draft.conflict = "";
          this.service.commitProperty(this.path, key, draft);
        });
        const discard = createStratumButton(row, {
          text: "Discard this draft",
        });
        discard.disabled = this.publish.busy;
        discard.addEventListener("click", () => {
          session.properties.delete(key);
          this.service.refresh();
        });
      }
    }
    if (structured && !aastex)
      for (const key of ["authors", "affiliations"] as const) {
        this.inclusion(this.container, key);
      }
    const available = keys.filter((key) => !visible.includes(key));
    if (available.length) {
      const select = createStratumSelect(this.container, {
        label: "Add property",
        ariaLabel: "Add publishing property",
        value: "",
        choices: [
          { value: "", label: "Choose a property" },
          ...available.map((key) => ({
            value: key,
            label: PUBLICATION_PROPERTIES[key],
          })),
        ],
      });
      select.disabled = this.publish.busy;
      select.addEventListener("change", () => {
        const key = select.value as PublicationPropertyKey;
        if (!available.includes(key)) return;
        this.commit({ key, value: list(key) ? [] : "" });
        const flag = flags[key];
        if (flag) void this.changeLayout({ [flag]: true }).catch(() => {});
      });
    }
    this.syncToggles();
    if (focused)
      this.container
        .querySelector<HTMLElement>(`[data-property-control="${focused}"]`)
        ?.focus();
  }
}
