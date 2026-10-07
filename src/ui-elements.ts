/** Decorate native Obsidian controls without changing their lifecycle or events. */
export function styleStratumComponent<
  T extends {
    inputEl?: HTMLInputElement | HTMLTextAreaElement;
    selectEl?: HTMLSelectElement;
    buttonEl?: HTMLButtonElement;
    toggleEl?: HTMLElement;
  },
>(component: T): T {
  component.inputEl?.addClass("stratum-control-input");
  component.selectEl?.addClass("stratum-control-select");
  component.buttonEl?.addClass("stratum-control-button");
  component.toggleEl?.addClass("stratum-control-toggle");
  return component;
}

// Element factories preserve native semantics and feature-specific attributes.
// Use the component factories below when Obsidian provides a suitable component.
function controlElement<K extends keyof HTMLElementTagNameMap>(
  container: HTMLElement,
  tag: K,
  className: string,
  options?: DomElementInfo,
): HTMLElementTagNameMap[K] {
  const element = container.createEl(tag, options);
  element.addClass(className);
  return element;
}

export function createStratumAction(
  container: HTMLElement,
  options?: DomElementInfo,
): HTMLButtonElement {
  const button = controlElement(
    container,
    "button",
    "stratum-control-button",
    options,
  );
  button.type = "button";
  return button;
}

export function createStratumInput(
  container: HTMLElement,
  options?: DomElementInfo,
): HTMLInputElement {
  return controlElement(
    container,
    "input",
    options?.type === "checkbox"
      ? "stratum-control-checkbox"
      : "stratum-control-input",
    options,
  );
}

export function createStratumTextarea(
  container: HTMLElement,
  options?: DomElementInfo,
): HTMLTextAreaElement {
  return controlElement(
    container,
    "textarea",
    "stratum-control-input",
    options,
  );
}

export function createStratumSelectElement(
  container: HTMLElement,
  options?: DomElementInfo,
): HTMLSelectElement {
  return controlElement(container, "select", "stratum-control-select", options);
}

export function createStratumDisclosure(
  container: HTMLElement,
  options?: DomElementInfo,
): HTMLDetailsElement {
  return controlElement(
    container,
    "details",
    "stratum-control-disclosure",
    options,
  );
}

export function createStratumSummary(
  container: HTMLElement,
  options?: DomElementInfo,
): HTMLElement {
  return controlElement(
    container,
    "summary",
    "stratum-control-summary",
    options,
  );
}
