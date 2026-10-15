// Minimal Obsidian host adapters over real browser DOM. No user vault is read.
import { parse as parseYamlText } from "yaml";
import { StateEffect, StateField } from "@codemirror/state";
import type { Editor } from "obsidian";

export const editorInfoField = StateField.define<{
  file: TFile;
  editor?: Editor;
}>({
  create: () => ({ file: new TFile() }),
  update: (value) => value,
});
export const setLivePreviewEffect = StateEffect.define<boolean>();
export const editorLivePreviewField = StateField.define<boolean>({
  create: () => true,
  update: (value, transaction) => {
    for (const effect of transaction.effects)
      if (effect.is(setLivePreviewEffect)) return effect.value;
    return value;
  },
});
function element<K extends keyof HTMLElementTagNameMap>(
  parent: HTMLElement | null,
  tag: K,
  options: DomElementInfo = {},
): HTMLElementTagNameMap[K] {
  // This implements the host createEl primitive itself.
  const child = document.createElement(tag);
  if (options.cls)
    child.className = Array.isArray(options.cls)
      ? options.cls.join(" ")
      : options.cls;
  if (typeof options.text === "string") child.textContent = options.text;
  else if (options.text) child.append(options.text);
  for (const [key, value] of Object.entries(options.attr ?? {}))
    child.setAttribute(key, String(value));
  if (options.type) child.setAttribute("type", options.type);
  if (options.value !== undefined) child.setAttribute("value", options.value);
  parent?.append(child);
  return child;
}

Object.assign(HTMLElement.prototype, {
  createEl<K extends keyof HTMLElementTagNameMap>(
    this: HTMLElement,
    tag: K,
    options?: DomElementInfo,
  ) {
    return element(this, tag, options);
  },
  createDiv(this: HTMLElement, options?: DomElementInfo) {
    return element(this, "div", options);
  },
  createSpan(this: HTMLElement, options?: DomElementInfo) {
    return element(this, "span", options);
  },
  empty(this: HTMLElement) {
    this.replaceChildren();
  },
  setText(this: HTMLElement, text: string) {
    this.textContent = text;
  },
  addClass(this: HTMLElement, ...names: string[]) {
    this.classList.add(...names);
  },
  removeClass(this: HTMLElement, ...names: string[]) {
    this.classList.remove(...names);
  },
  toggleClass(this: HTMLElement, name: string, value: boolean) {
    this.classList.toggle(name, value);
  },
  setCssProps(this: HTMLElement, props: Record<string, string>) {
    for (const [key, value] of Object.entries(props))
      this.style.setProperty(key, value);
  },
  setAttr(this: HTMLElement, key: string, value: string) {
    this.setAttribute(key, value);
  },
});
// Obsidian gives each node its own document and window, for pop-out windows.
Object.defineProperties(Node.prototype, {
  doc: {
    configurable: true,
    get(this: Node) {
      return this.ownerDocument;
    },
  },
  win: {
    configurable: true,
    get(this: Node) {
      return this.ownerDocument?.defaultView;
    },
  },
});
Object.assign(window, {
  createDiv: (options?: DomElementInfo) => element(null, "div", options),
  createEl: <K extends keyof HTMLElementTagNameMap>(
    tag: K,
    options?: DomElementInfo,
  ) => element(null, tag, options),
  queryLocalFonts: () =>
    Promise.resolve(
      ["Arial", "Georgia", "Times New Roman"].map((family) => ({ family })),
    ),
});

export class Component {
  private cleanup: (() => void)[] = [];
  addChild<T extends Component>(child: T): T {
    child.load();
    this.register(() => child.unload());
    return child;
  }
  register(callback: () => void) {
    this.cleanup.push(callback);
  }
  onload() {}
  onunload() {}
  // Match Obsidian's lifecycle so subclasses' load and unload hooks run.
  load() {
    this.onload();
  }
  unload() {
    this.onunload();
    this.cleanup.splice(0).forEach((callback) => callback());
  }
}
export class Modal {
  modalEl = document.createElement("div");
  contentEl = document.createElement("div");
  private heading = document.createElement("h2");
  private previousFocus?: HTMLElement;
  constructor(_app: unknown) {
    this.modalEl.className = "modal";
    this.modalEl.setAttribute("role", "dialog");
    this.modalEl.setAttribute("aria-modal", "true");
    this.modalEl.append(this.heading, this.contentEl);
    this.modalEl.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        this.close();
      }
      if (event.key === "Tab") {
        const controls = Array.from(
          this.modalEl.querySelectorAll<HTMLElement>(
            'button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),summary,[tabindex="0"]',
          ),
        ).filter(
          (control) =>
            control.tabIndex >= 0 && control.getClientRects().length > 0,
        );
        const first = controls[0],
          last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    });
  }
  setTitle(title: string) {
    this.heading.textContent = title;
    this.modalEl.setAttribute("aria-label", title);
  }
  onOpen() {}
  onClose() {}
  open() {
    this.previousFocus = document.activeElement as HTMLElement;
    document.body.append(this.modalEl);
    this.onOpen();
    this.modalEl
      .querySelector<HTMLElement>(
        'button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),summary,[tabindex="0"]',
      )
      ?.focus();
  }
  close() {
    if (!this.modalEl.isConnected) return;
    this.modalEl.remove();
    this.onClose();
    if (this.previousFocus?.isConnected) this.previousFocus.focus();
  }
}
export class Notice {
  constructor(_message: string) {}
}
export class FileSystemAdapter {}
export class MarkdownView {}
export class TFile {
  // Native files have a parent whose children include the file itself.
  parent = { children: [this] };
  path = "Papers/Synthetic paper.md";
  basename = "Synthetic paper";
  extension = "md";
  stat = { ctime: 1, mtime: 1, size: 1 };
}
export const Platform = { isDesktopApp: true, isDesktop: true };
export const parseYaml = (source: string): unknown => parseYamlText(source);
export const MarkdownRenderer = {
  render(_app: unknown, markdown: string, root: HTMLElement) {
    // Host rendering is outside this fixture's scope; use synthetic text only.
    root.createEl("p", { text: markdown });
    return Promise.resolve();
  },
};
export function setTooltip(button: HTMLElement, text: string) {
  button.dataset.tooltip = text;
  button.setAttribute("aria-label", text);
}
export function setIcon(button: HTMLElement, icon: string) {
  if (icon === "file-text") {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    for (const [key, value] of Object.entries({
      viewBox: "0 0 24 24",
      width: "18",
      height: "18",
      fill: "none",
      stroke: "currentColor",
      "stroke-width": "2",
      "aria-hidden": "true",
    }))
      svg.setAttribute(key, value);
    for (const d of [
      "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z",
      "M14 2v6h6",
      "M8 13h8",
      "M8 17h8",
    ]) {
      const path = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "path",
      );
      path.setAttribute("d", d);
      svg.append(path);
    }
    button.append(svg);
    return;
  }
  const glyphs: Record<string, string> = {
    settings: "⚙",
    "arrow-up": "↑",
    "arrow-down": "↓",
    "trash-2": "×",
  };
  button.createSpan({
    text: glyphs[icon] ?? "↗",
    attr: { "aria-hidden": "true" },
  });
}

export class ButtonComponent {
  buttonEl: HTMLButtonElement;
  constructor(parent: HTMLElement) {
    this.buttonEl = parent.createEl("button");
  }
  setButtonText(text: string) {
    this.buttonEl.setText(text);
    return this;
  }
  setTooltip(text: string) {
    setTooltip(this.buttonEl, text);
    return this;
  }
  setCta() {
    this.buttonEl.addClass("mod-cta");
    return this;
  }
  setDisabled(value: boolean) {
    this.buttonEl.disabled = value;
    return this;
  }
  onClick(callback: () => void) {
    this.buttonEl.addEventListener("click", callback);
    return this;
  }
}
export class DropdownComponent {
  selectEl: HTMLSelectElement;
  constructor(parent: HTMLElement) {
    this.selectEl = parent.createEl("select");
  }
  addOption(value: string, text: string) {
    this.selectEl.createEl("option", { value, text });
    return this;
  }
  setValue(value: string) {
    this.selectEl.value = value;
    return this;
  }
  onChange(callback: (value: string) => void) {
    this.selectEl.addEventListener("change", () =>
      callback(this.selectEl.value),
    );
    return this;
  }
}
export class SearchComponent {}
// Native Obsidian uses a focusable label containing a checkbox input.
// Its programmatic setter invokes onChange when the value changes.
export class ToggleComponent {
  toggleEl: HTMLLabelElement;
  private value = false;
  private disabled = false;
  private change?: (value: boolean) => void;
  constructor(parent: HTMLElement) {
    this.toggleEl = parent.createEl("label", {
      cls: "checkbox-container",
      attr: { tabindex: "0" },
    });
    this.toggleEl.createEl("input", {
      type: "checkbox",
      attr: { tabindex: "-1" },
    });
    this.toggleEl.addEventListener("change", () => this.onClick());
    this.toggleEl.addEventListener("keydown", (event) => {
      if (event.key === " " || event.key === "Enter") {
        event.preventDefault();
        this.onClick();
      }
    });
  }
  getValue() {
    return this.value;
  }
  setValue(value: boolean) {
    // Match native Obsidian: programmatic changes also invoke onChange.
    if (this.value !== value) {
      this.value = value;
      this.toggleEl.classList.toggle("is-enabled", value);
      this.change?.(value);
    }
    return this;
  }
  setDisabled(disabled: boolean) {
    this.disabled = disabled;
    this.toggleEl.classList.toggle("is-disabled", disabled);
    return this;
  }
  onClick() {
    if (this.disabled) return;
    this.setValue(!this.value);
  }
  onChange(callback: (value: boolean) => void) {
    this.change = callback;
    return this;
  }
}
export class Setting {
  settingEl: HTMLDivElement;
  private nameEl: HTMLElement;
  private descEl: HTMLElement;
  private controls: HTMLElement;
  constructor(parent: HTMLElement) {
    this.settingEl = parent.createDiv({ cls: "setting-item" });
    const info = this.settingEl.createDiv({ cls: "setting-item-info" });
    this.nameEl = info.createDiv({ cls: "setting-item-name" });
    this.descEl = info.createDiv({ cls: "setting-item-description" });
    this.controls = this.settingEl.createDiv({ cls: "setting-item-control" });
  }
  setName(text: string) {
    this.nameEl.setText(text);
    return this;
  }
  setDesc(text: string) {
    this.descEl.setText(text);
    return this;
  }
  addButton(callback: (component: ButtonComponent) => void) {
    callback(new ButtonComponent(this.controls));
    return this;
  }
  addDropdown(callback: (component: DropdownComponent) => void) {
    callback(new DropdownComponent(this.controls));
    return this;
  }
  addToggle(callback: (component: ToggleComponent) => void) {
    callback(new ToggleComponent(this.controls));
    return this;
  }
}
export function requestUrl(): never {
  throw new Error("Network requests are outside the publishing fixture");
}

export class WorkspaceWindow {}
