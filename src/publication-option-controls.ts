import type { ToggleComponent } from "obsidian";
import { createStratumToggle } from "./ui-controls";
import {
  DEFAULT_AASTEX_PDF_OPTIONS,
  type AastexPdfOptions,
} from "./publication-options";

export const AASTEX_OPTION_LABELS: Record<keyof AastexPdfOptions, string> = {
  showLineNumbers: "Show line numbers",
  showDraftDateHeader: "Show draft date header",
  numberedHeadings: "Headings already contain numbers",
};
export function aastexOptionToggle(
  parent: HTMLElement,
  key: keyof AastexPdfOptions,
  change: (value: boolean) => void,
  value = DEFAULT_AASTEX_PDF_OPTIONS[key],
): ToggleComponent {
  return createStratumToggle(parent, {
    label: AASTEX_OPTION_LABELS[key],
    value,
    onChange: change,
    className: "stratum-aastex-option",
  });
}
