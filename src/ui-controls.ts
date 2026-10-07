import {
  ButtonComponent,
  DropdownComponent,
  SearchComponent,
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
  if (options.className) button.addClass(options.className);
  return button;
}
