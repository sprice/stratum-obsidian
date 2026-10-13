import {
  ButtonComponent,
  DropdownComponent,
  SearchComponent,
  ToggleComponent,
  setIcon,
  setTooltip,
} from "obsidian";

export {
  createStratumAction,
  createStratumInput,
  createStratumTextarea,
  createStratumSelectElement,
  createStratumDisclosure,
  createStratumSummary,
  styleStratumComponent,
} from "./ui-elements";
import { createStratumAction, styleStratumComponent } from "./ui-elements";

export function createStratumField(
  container: HTMLElement,
  label: string,
): HTMLLabelElement {
  return container.createEl("label", {
    text: label,
    cls: "stratum-control-field",
  });
}

export function createStratumIconButton(
  container: HTMLElement,
  options: {
    icon: string;
    ariaLabel: string;
    tooltip?: string;
    className?: string;
  },
): HTMLButtonElement {
  const button = createStratumAction(container, {
    cls: options.className
      ? `clickable-icon ${options.className}`
      : "clickable-icon",
    attr: {
      "aria-label": options.ariaLabel,
    },
  });
  setIcon(button, options.icon);
  setTooltip(button, options.tooltip ?? options.ariaLabel);
  button.setAttribute("aria-label", options.ariaLabel);
  return button;
}

type SelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

export function createStratumDropdown(
  container: HTMLElement,
  options: {
    label?: string;
    ariaLabel: string;
    value: string;
    choices: SelectOption[];
  },
): DropdownComponent {
  const field =
    options.label === undefined
      ? container
      : createStratumField(container, options.label);
  const component = styleStratumComponent(new DropdownComponent(field));
  const select = component.selectEl;
  select.setAttribute("aria-label", options.ariaLabel);
  for (const choice of options.choices) {
    const option = select.createEl("option", {
      value: choice.value,
      text: choice.label,
    });
    option.disabled = choice.disabled ?? false;
  }
  select.value = options.value;
  return component;
}

export function createStratumSelect(
  container: HTMLElement,
  options: Parameters<typeof createStratumDropdown>[1],
): HTMLSelectElement {
  return createStratumDropdown(container, options).selectEl;
}

export function createStratumSearch(
  container: HTMLElement,
  options: {
    label?: string;
    ariaLabel: string;
    placeholder: string;
    value: string;
    onChange?: (value: string) => void;
  },
): SearchComponent {
  const field =
    options.label === undefined
      ? container
      : createStratumField(container, options.label);
  const frame = field.createDiv({ cls: "stratum-control-search" });
  const search = styleStratumComponent(new SearchComponent(frame))
    .setPlaceholder(options.placeholder)
    .setValue(options.value);
  if (options.onChange) search.onChange(options.onChange);
  search.inputEl.setAttribute("aria-label", options.ariaLabel);
  return search;
}

export function createStratumButton(
  container: HTMLElement,
  options: {
    text: string;
    tooltip?: string;
    primary?: boolean;
    wrap?: boolean;
    className?: string;
  },
): HTMLButtonElement {
  const component = styleStratumComponent(
    new ButtonComponent(container),
  ).setButtonText(options.text);
  if (options.tooltip) component.setTooltip(options.tooltip);
  if (options.primary) component.setCta();
  const button = component.buttonEl;
  button.type = "button";
  if (options.primary) button.addClass("stratum-control-cta");
  if (options.wrap) button.addClass("stratum-control-wrap");
  if (options.className) button.addClass(options.className);
  return button;
}

export interface StratumTabItem<T extends string> {
  id: T;
  label: string;
  className?: string;
}

export interface StratumTabs<T extends string> {
  tabId(id: T): string;
  panelId(id: T): string;
  /** The tab button, for feature content such as a status icon. */
  tab(id: T): HTMLButtonElement | undefined;
  /** Reflect the selected tab; selection changes go through `onSelect`. */
  select(id: T | null): void;
}

/**
 * Tab list in the main Stratum tab bar style, with stable ids and roving
 * focus. The caller owns selection state and the tab panels.
 */
export function createStratumTabs<T extends string>(
  container: HTMLElement,
  options: {
    idPrefix: string;
    label: string;
    tabs: readonly StratumTabItem<T>[];
    selected: T | null;
    onSelect: (id: T, fromKeyboard: boolean) => void;
  },
): StratumTabs<T> {
  const tabId = (id: T) => `${options.idPrefix}-tab-${id}`;
  const panelId = (id: T) => `${options.idPrefix}-panel-${id}`;
  const ids = options.tabs.map((item) => item.id);
  // A hidden label avoids the tooltip Obsidian shows for aria-label.
  const label = container.createSpan({ text: options.label });
  label.id = `${options.idPrefix}-tablist-label`;
  label.hidden = true;
  const tabList = container.createDiv({ cls: "stratum-tab-bar" });
  tabList.setAttribute("role", "tablist");
  tabList.setAttribute("aria-labelledby", label.id);
  tabList.setCssProps({
    "--stratum-tab-count": String(Math.min(3, ids.length)),
    "--stratum-compact-tab-count": String(Math.min(2, ids.length)),
  });
  const buttons = new Map<T, HTMLButtonElement>();
  options.tabs.forEach((item, index) => {
    const button = createStratumAction(tabList, { text: item.label });
    if (item.className) button.addClass(item.className);
    button.id = tabId(item.id);
    button.setAttribute("role", "tab");
    button.setAttribute("aria-controls", panelId(item.id));
    buttons.set(item.id, button);
    button.addEventListener("click", () => options.onSelect(item.id, false));
    button.addEventListener("keydown", (event) => {
      const last = ids.length - 1;
      const next =
        event.key === "ArrowRight"
          ? ids[index === last ? 0 : index + 1]
          : event.key === "ArrowLeft"
            ? ids[index === 0 ? last : index - 1]
            : event.key === "Home"
              ? ids[0]
              : event.key === "End"
                ? ids[last]
                : undefined;
      if (next === undefined) return;
      event.preventDefault();
      options.onSelect(next, true);
      buttons.get(next)?.focus();
    });
  });
  const select = (selected: T | null) => {
    const focusable = selected !== null && buttons.has(selected);
    for (const [id, button] of buttons) {
      const active = id === selected;
      button.toggleClass("is-active", active);
      button.setAttribute("aria-selected", String(active));
      button.tabIndex = active || (!focusable && id === ids[0]) ? 0 : -1;
    }
  };
  select(options.selected);
  return { tabId, panelId, tab: (id) => buttons.get(id), select };
}

export function createStratumToggle(
  container: HTMLElement,
  options: {
    label: string;
    value: boolean;
    onChange: (value: boolean) => void;
    className?: string;
  },
): ToggleComponent {
  const row = container.createDiv({
    cls: options.className
      ? `stratum-control-toggle-field ${options.className}`
      : "stratum-control-toggle-field",
  });
  row.createSpan({ text: options.label });
  const component = styleStratumComponent(new ToggleComponent(row)).setValue(
    options.value,
  );
  const input = component.toggleEl.querySelector<HTMLInputElement>(
    'input[type="checkbox"]',
  );
  if (input) {
    input.setAttribute("aria-label", options.label);
    input.checked = options.value;
  }
  component.onChange((value) => {
    if (input) input.checked = value;
    options.onChange(value);
  });
  component.toggleEl.setAttribute("aria-label", options.label);
  return component;
}

/** Shared spacing for publishing settings dialog actions. */
export function createPublishingFooter(container: HTMLElement): HTMLDivElement {
  return container.createDiv({
    cls: "stratum-publish-actions stratum-publishing-footer",
  });
}

/** Publishing option groups share control and section spacing. */
export function stylePublishingOptions(container: HTMLElement): void {
  container.addClass("stratum-publishing-options");
}
