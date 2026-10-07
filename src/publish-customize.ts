import {
  createPublicationSection,
  renderPublicationDesign,
  renderPublicationPreview,
} from "./publish-design-controls";
import {
  createStratumInput,
  createStratumField,
  createStratumSelect,
} from "./ui-controls";
import { renderPublishFontControls } from "./publish-font-controls";
import { type PublishOptions } from "./publish-options";
export function renderPublishCustomization(
  container: HTMLElement,
  options: PublishOptions,
  change: (patch: Partial<PublishOptions>) => Promise<void>,
  fail: (error: unknown) => void,
  format?: "pdf" | "docx",
): (key: "bodyFont" | "titleFont" | "opening") => void {
  const preview = container.createDiv();
  let current = { ...options };
  renderPublicationPreview(preview, current);
  const save = change;
  change = async (patch) => {
    await save(patch);
    current = { ...current, ...patch };
    renderPublicationPreview(preview, current);
  };
  const { details: disclosure, body: appearance } = createPublicationSection(
    container,
    "Appearance",
  );
  const parent = container;
  container = appearance;
  container.addClass("stratum-publish-customize");
  const fields = container.createDiv({ cls: "stratum-publish-fields" });
  const loadFonts = renderPublishFontControls(
    fields,
    container,
    options,
    change,
    fail,
    format,
  );
  disclosure.addEventListener("toggle", () => {
    if (disclosure.open) loadFonts();
  });
  const numeric = (
    label: string,
    key: "bodySize" | "titleSize" | "margin" | "lineSpacing",
    min: number,
    max: number,
    step: number,
  ) => {
    const field = createStratumField(fields, label);
    const input = createStratumInput(field, {
      type: "number",
      value: String(options[key]),
      attr: {
        min: String(min),
        max: String(max),
        step: String(step),
        "aria-label": label,
      },
    });
    input.addEventListener("change", () => {
      const value = Number(input.value);
      if (
        !input.value ||
        !Number.isFinite(value) ||
        value < min ||
        value > max
      ) {
        input.value = String(options[key]);
        input.reportValidity();
        return;
      }
      void change({ [key]: value }).catch(fail);
    });
  };
  numeric("Body size (pt)", "bodySize", 8, 24, 0.5);
  numeric("Title size (pt)", "titleSize", 12, 48, 0.5);
  numeric("Margins (in)", "margin", 0.4, 2, 0.1);
  const spacing = createStratumSelect(fields, {
    label: "Line spacing",
    ariaLabel: "Line spacing",
    value: String(options.lineSpacing),
    choices: [...new Set([1, 1.15, 1.5, 2, options.lineSpacing])].map(
      (value) => ({ value: String(value), label: `${value}` }),
    ),
  });
  spacing.addEventListener("change", () => {
    void change({ lineSpacing: Number(spacing.value) }).catch(fail);
  });
  const paper = createStratumSelect(fields, {
    label: "Paper size",
    ariaLabel: "Paper size",
    value: options.paperSize,
    choices: [
      { value: "letter", label: "Letter" },
      { value: "a4", label: "A4" },
    ],
  });
  paper.addEventListener("change", () => {
    void change({ paperSize: paper.value as "letter" | "a4" }).catch(fail);
  });
  const focusOpening = renderPublicationDesign(parent, options, change, fail);
  return (key) => {
    if (key === "opening") return focusOpening();
    disclosure.open = true;
    loadFonts();
    const select = fields.querySelector<HTMLSelectElement>(
      `select[aria-label="${key === "bodyFont" ? "Body font" : "Title font"}"]`,
    );
    select?.scrollIntoView({ block: "center" });
    select?.focus();
  };
}
