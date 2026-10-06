import { ButtonComponent, DropdownComponent, SearchComponent } from "obsidian";

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
      : container.createEl("label", {
          text: options.label,
          cls: "stratum-control-field",
        });
  const component = new DropdownComponent(field);
  const select = component.selectEl;
  select.addClass("stratum-control-select");
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
      : container.createEl("label", {
          text: options.label,
          cls: "stratum-control-field",
        });
  const frame = field.createDiv({ cls: "stratum-control-search" });
  const search = new SearchComponent(frame)
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
  const component = new ButtonComponent(container).setButtonText(options.text);
  if (options.tooltip) component.setTooltip(options.tooltip);
  if (options.primary) component.setCta();
  const button = component.buttonEl;
  button.type = "button";
  button.addClass("stratum-control-button");
  if (options.primary) button.addClass("stratum-control-cta");
  if (options.className) button.addClass(options.className);
  return button;
}
