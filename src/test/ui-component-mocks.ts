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
