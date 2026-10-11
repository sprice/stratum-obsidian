import type { AastexPdfOptions } from "./publication-options";

export const AASTEX_OPTION_LABELS: Record<keyof AastexPdfOptions, string> = {
  showLineNumbers: "Show line numbers",
  showDraftDateHeader: "Show draft date header",
  numberedHeadings: "Headings already contain numbers",
};
export function aastexOptionCheckbox(
  parent: HTMLElement,
  key: keyof AastexPdfOptions,
  change: (value: boolean) => void,
): HTMLInputElement {
  const label = parent.createEl("label", { cls: "stratum-aastex-option" });
  const input = label.createEl("input", { type: "checkbox" });
  label.createSpan({ text: AASTEX_OPTION_LABELS[key] });
  input.addEventListener("change", () => change(input.checked));
  return input;
}
