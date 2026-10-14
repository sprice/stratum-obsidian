// Host component doubles; tests still exercise the real Stratum wrappers.
export class ButtonComponentMock {
  buttonEl: HTMLButtonElement;
  constructor(parent: HTMLElement) {
    this.buttonEl = parent.createEl("button");
  }
  setButtonText(text: string) {
    this.buttonEl.setText(text);
    return this;
  }
  setTooltip(text: string) {
    this.buttonEl.setAttribute("aria-label", text);
    return this;
  }
  setCta() {
    this.buttonEl.addClass("mod-cta");
    return this;
  }
}

export class DropdownComponentMock {
  selectEl: HTMLSelectElement;
  constructor(parent: HTMLElement) {
    this.selectEl = parent.createEl("select");
  }
}

export class ToggleComponentMock {
  toggleEl: HTMLElement;
  private value = false;
  private disabled = false;
  private change?: (value: boolean) => void;
  constructor(parent: HTMLElement) {
    this.toggleEl = parent.createEl("label", { cls: "checkbox-container" });
    this.toggleEl.createEl("input", { type: "checkbox" });
    this.toggleEl.addEventListener("click", () => {
      if (!this.disabled) this.setValue(!this.value);
    });
  }
  setValue(value: boolean) {
    if (this.value !== value) {
      this.value = value;
      this.change?.(value);
    }
    return this;
  }
  getValue() {
    return this.value;
  }
  setDisabled(disabled: boolean) {
    this.disabled = disabled;
    this.toggleEl.setAttribute("aria-disabled", String(disabled));
    return this;
  }
  onChange(callback: (value: boolean) => void) {
    this.change = callback;
    return this;
  }
}

export class SettingMock {
  settingEl: HTMLElement;
  infoEl: HTMLElement;
  nameEl: HTMLElement;
  controlEl: HTMLElement;
  constructor(parent: HTMLElement) {
    this.settingEl = parent.createDiv({ cls: "setting-item" });
    this.infoEl = this.settingEl.createDiv({ cls: "setting-item-info" });
    this.nameEl = this.infoEl.createDiv({ cls: "setting-item-name" });
    this.controlEl = this.settingEl.createDiv({ cls: "setting-item-control" });
  }
  setName(name: string) {
    this.nameEl.setText(name);
    return this;
  }
  addToggle(callback: (component: ToggleComponentMock) => unknown) {
    callback(new ToggleComponentMock(this.controlEl));
    return this;
  }
}
