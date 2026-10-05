import { ButtonComponent, DropdownComponent, SearchComponent } from "obsidian";

type SelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

export function createStratumSelect(
  container: HTMLElement,
  options: {
    label: string;
    ariaLabel: string;
    value: string;
    choices: SelectOption[];
  },
): HTMLSelectElement {
  const field = container.createEl("label", {
    text: options.label,
    cls: "stratum-control-field",
  });
  const select = new DropdownComponent(field).selectEl;
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
  return select;
}

export function createStratumSearch(
  container: HTMLElement,
  options: {
    label: string;
    ariaLabel: string;
    placeholder: string;
    value: string;
    onChange: (value: string) => void;
  },
): SearchComponent {
  const field = container.createEl("label", {
    text: options.label,
    cls: "stratum-control-field",
  });
  const search = new SearchComponent(field)
    .setPlaceholder(options.placeholder)
    .setValue(options.value)
    .onChange(options.onChange);
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
  button.addClass(
    options.primary ? "stratum-control-cta" : "stratum-control-button",
  );
  if (options.className) button.addClass(options.className);
  return button;
}
