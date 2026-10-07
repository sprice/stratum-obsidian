// Minimal Obsidian host adapters over real browser DOM. No user vault is read.
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
  setAttr(this: HTMLElement, key: string, value: string) {
    this.setAttribute(key, value);
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
  constructor(_app: unknown) {}
}
export class Notice {
  constructor(_message: string) {}
}
export class FileSystemAdapter {}
export class MarkdownView {}
export class TFile {
  path = "Papers/Synthetic paper.md";
  basename = "Synthetic paper";
  extension = "md";
  stat = { ctime: 1, mtime: 1, size: 1 };
}
export const Platform = { isDesktopApp: true, isDesktop: true };
export const parseYaml = (source: string): unknown => JSON.parse(source);
export const MarkdownRenderer = {
  render(_app: unknown, markdown: string, root: HTMLElement) {
    // Host rendering is outside this fixture's scope; use synthetic text only.
    root.createEl("p", { text: markdown });
    return Promise.resolve();
  },
};
export function setTooltip(button: HTMLElement, text: string) {
  button.setAttribute("aria-label", text);
}
export function setIcon(button: HTMLElement, icon: string) {
  button.createSpan({
    text: icon === "settings" ? "⚙" : "↗",
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
class ToggleComponent {
  toggleEl: HTMLInputElement;
  constructor(parent: HTMLElement) {
    this.toggleEl = parent.createEl("input", { type: "checkbox" });
  }
  setValue(value: boolean) {
    this.toggleEl.checked = value;
    return this;
  }
  onChange(callback: (value: boolean) => void) {
    this.toggleEl.addEventListener("change", () =>
      callback(this.toggleEl.checked),
    );
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
