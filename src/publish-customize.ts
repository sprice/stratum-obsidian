import { createStratumButton, createStratumSelect } from "./ui-controls";
import { installedPublishFonts } from "./publish-desktop";
import {
  DEFAULT_WORD_FONT,
  fontName,
  type PublishOptions,
} from "./publish-options";
/** Input the user can correct, rather than a failed save. */
export class PublishOptionError extends Error {}
let fontListId = 0;
let installed: string[] | null = null;
export function renderPublishCustomization(
  container: HTMLElement,
  options: PublishOptions,
  change: (patch: Partial<PublishOptions>) => Promise<void>,
  fail: (error: unknown) => void,
  format?: "pdf" | "docx",
): void {
  container.addClass("stratum-publish-customize");
  const fields = container.createDiv({ cls: "stratum-publish-fields" });
  const dataId = `stratum-publish-fonts-${++fontListId}`;
  const list = container.createEl("datalist", { attr: { id: dataId } });
  const fillFonts = (families: string[]) => {
    list.empty();
    for (const font of [
      ...new Set(["Times New Roman", "Arial", "Georgia", ...families]),
    ])
      list.createEl("option", { value: font });
  };
  fillFonts(installed ?? []);
  const font = (label: string, key: "bodyFont" | "titleFont") => {
    const field = fields.createEl("label", {
      text: label,
      cls: "stratum-control-field",
    });
    const input = field.createEl("input", {
      type: "text",
      value: options[key],
      attr: {
        list: dataId,
        "aria-label": label,
        placeholder: key === "titleFont" ? "Same as body" : "Default font",
        maxlength: "120",
      },
    });
    const sample = field.createSpan({
      text: "The quick brown fox · α β 123",
      cls: "stratum-publish-font-sample",
    });
    const preview = () => {
      // Preview the font each format uses when no font is named.
      sample.style.fontFamily =
        fontName(input.value) ||
        options.bodyFont ||
        (format === "pdf" ? "serif" : DEFAULT_WORD_FONT);
    };
    preview();
    input.addEventListener("input", preview);
    input.addEventListener("change", () => {
      const name = fontName(input.value);
      if (!name && input.value.trim()) {
        input.value = options[key];
        fail(
          new PublishOptionError(
            "Enter a font family name without TeX special characters.",
          ),
        );
        return;
      }
      if (key === "bodyFont") fontMode.value = name ? "custom" : "default";
      void change({ [key]: name }).catch(fail);
    });
  };
  const fontMode = createStratumSelect(fields, {
    label: "Body font choice",
    ariaLabel: "Body font choice",
    value: options.bodyFont ? "custom" : "default",
    choices: [
      {
        value: "default",
        label:
          format === "pdf"
            ? "Default typesetting font"
            : format === "docx"
              ? "Default (Times New Roman)"
              : "Default font",
      },
      { value: "custom", label: "Choose a font" },
    ],
  });
  fontMode.addEventListener("change", () => {
    if (fontMode.value === "default") {
      const input = fields.querySelector<HTMLInputElement>(
        'input[aria-label="Body font"]',
      );
      if (input) {
        input.value = "";
        input.dispatchEvent(new Event("input"));
      }
      void change({ bodyFont: "" }).catch(fail);
    } else
      fields
        .querySelector<HTMLInputElement>('input[aria-label="Body font"]')
        ?.focus();
  });
  font("Body font", "bodyFont");
  font("Title font", "titleFont");
  const load = createStratumButton(container, {
    text: "Load installed fonts",
    tooltip: "List fonts available on this computer",
  });
  const status = container.createEl("p", {
    cls: "stratum-publish-meta",
    attr: { role: "status" },
  });
  load.addEventListener("click", () => {
    load.disabled = true;
    status.setText("Finding installed fonts…");
    void installedPublishFonts()
      .then((fonts) => {
        installed = fonts;
        fillFonts(fonts);
        status.setText(
          `${fonts.length} font families available. Type to search.`,
        );
      })
      .catch(() =>
        status.setText(
          "Installed fonts could not be listed. You can still enter a font family name.",
        ),
      )
      .finally(() => {
        load.disabled = false;
      });
  });
  const numeric = (
    label: string,
    key: "bodySize" | "titleSize" | "margin" | "lineSpacing",
    min: number,
    max: number,
    step: number,
  ) => {
    const field = fields.createEl("label", {
      text: label,
      cls: "stratum-control-field",
    });
    const input = field.createEl("input", {
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
  const numbering = fields.createEl("label", {
    text: "Number sections",
    cls: "stratum-control-field",
  });
  const check = numbering.createEl("input", {
    type: "checkbox",
    attr: { "aria-label": "Number sections" },
  });
  check.checked = options.numberSections;
  check.addEventListener("change", () => {
    void change({ numberSections: check.checked }).catch(fail);
  });
  container.createEl("p", {
    cls: "stratum-publish-meta",
    text: `Word recipients may need your selected fonts installed. PDF publishing requires fonts installed on this computer, except the default typesetting font, which uses the PDF engine’s default. Word uses ${DEFAULT_WORD_FONT} when no body font is chosen. Equation fonts are handled separately.`,
  });
}
