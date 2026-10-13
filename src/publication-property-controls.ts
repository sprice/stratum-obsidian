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
  createStratumTextarea,
  createStratumToggle,
  setStratumFieldMessage,
} from "./ui-controls";
import type { PublishOptions } from "./publish-options";
import { publishingIssueText } from "./publish-properties";
import { StableRender } from "./ui-render";
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
  private render: StableRender;
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
    this.render = new StableRender(container, "data-property-control");
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
  private inclusion(
    parent: HTMLElement,
    key: "authors" | "affiliations" | "date" | "keywords",
  ): void {
    const flag = flags[key]!;
    const toggle = createStratumToggle(parent, {
      label: PUBLICATION_PROPERTIES[key],
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
              !toggle.toggleEl.contains(toggle.toggleEl.doc.activeElement)),
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
      this.container.contains(this.container.doc.activeElement) &&
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
    const academic = this.publish.selectedTemplate?.documentType === "academic";
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
          : (!structured && !academic) ||
            !["authors", "affiliations"].includes(key)) ||
        session.properties.has(key),
    );
    const requiredTitle = this.publish.layout.titleSource === "properties";
    const visible = keys.filter((key) =>
      key === "title"
        ? Object.hasOwn(properties, key) ||
          requiredTitle ||
          session.properties.has(key)
        : true,
    );
    const enabled = (key: PublicationPropertyKey) =>
      !!(
        this.pending.get(flags[key]!)?.value ?? this.publish.layout[flags[key]!]
      );
    // Settings shows every other issue in its validation block.
    const titleIssues =
      this.publish.document?.path === this.path
        ? this.publish.publishingIssues.filter(
            (issue) => issue.target === "title",
          )
        : [];
    const titleMessage = titleIssues.map(publishingIssueText).join("\n");
    const titleInvalid = titleIssues.some((issue) => issue.blocking);
    const showTitleIssue = () => {
      const input = this.container.querySelector<HTMLInputElement>(
        'input[data-property-control="title"]',
      );
      if (input) setStratumFieldMessage(input, titleMessage, titleInvalid);
    };
    const signature = JSON.stringify([
      titleMessage,
      titleInvalid,
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
      this.publish.preferencesSaving,
      [...this.pending],
      this.publish.busy,
      visible,
    ]);
    if (!this.render.changed(signature)) return;
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
    if (this.render.keeps(structure)) {
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
      for (const field of Array.from(
        this.container.querySelectorAll<HTMLElement>(
          "[data-publication-optional]",
        ),
      )) {
        const key = field.dataset.publicationOptional as PublicationPropertyKey;
        field.hidden = !enabled(key) && !session.properties.get(key)?.conflict;
      }
      showTitleIssue();
      this.syncToggles();
      return;
    }
    this.toggles.clear();
    const restoreFocus = this.render.clear();
    for (const key of visible) {
      const required = key === "title" && requiredTitle;
      const row = this.container.createDiv({
        cls: "stratum-publishing-property",
      });
      if (key !== "title" && !aastex) this.inclusion(row, key);
      const field = createStratumField(
        row,
        key === "title"
          ? PUBLICATION_PROPERTIES[key] + (required ? " · required" : "")
          : "",
      );
      if (key !== "title") {
        field.dataset.publicationOptional = key;
        field.hidden = !enabled(key) && !session.properties.get(key)?.conflict;
      }
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
    if ((structured || academic) && !aastex)
      for (const key of ["authors", "affiliations"] as const) {
        this.inclusion(this.container, key);
      }
    showTitleIssue();
    this.syncToggles();
    restoreFocus();
  }
}
