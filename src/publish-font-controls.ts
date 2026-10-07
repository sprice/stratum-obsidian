import { installedPublishFonts } from "./publish-desktop";
import { fontName, type PublishOptions } from "./publish-options";
import { createStratumButton, createStratumSelect } from "./ui-controls";

export const COMMON_PAPER_FONTS = [
  "Arial",
  "Cambria",
  "Charter",
  "DejaVu Serif",
  "Georgia",
  "Latin Modern Roman",
  "Liberation Sans",
  "Liberation Serif",
  "Noto Serif",
  "Palatino",
  "Palatino Linotype",
  "STIX Two Text",
  "TeX Gyre Pagella",
  "TeX Gyre Termes",
  "Times New Roman",
] as const satisfies readonly string[];

const commonFonts = new Set<string>(
  COMMON_PAPER_FONTS.map((family) => family.toLowerCase()),
);

function discoverFonts(): Promise<string[]> {
  return installedPublishFonts().then((fonts) => {
    const families = new Map<string, string>();
    for (const font of fonts) {
      const family = fontName(font);
      if (family && !families.has(family.toLowerCase()))
        families.set(family.toLowerCase(), family);
    }
    return [...families.values()].sort((a, b) => a.localeCompare(b));
  });
}

/** Both publishing surfaces use the same font choices and session discovery cache. */
export function renderPublishFontControls(
  fields: HTMLElement,
  container: HTMLElement,
  options: PublishOptions,
  change: (patch: Partial<PublishOptions>) => Promise<void>,
  fail: (error: unknown) => void,
  format?: "pdf" | "docx",
): () => void {
  // This is only the rendered list; every reopening reads the shared discovery cache.
  let installed: string[] | undefined;
  const controls = (["bodyFont", "titleFont"] as const).map((key) => {
    const label = key === "bodyFont" ? "Body font" : "Title font";
    const automatic =
      key === "titleFont"
        ? "Same as body"
        : format === "pdf"
          ? "Default typesetting font"
          : format === "docx"
            ? "Default (Times New Roman)"
            : "Default font";
    const select = createStratumSelect(fields, {
      label,
      ariaLabel: label,
      value: options[key],
      choices: [{ value: "", label: automatic }],
    });
    let saved = options[key];
    let initial = true;
    const populate = () => {
      const current = initial ? saved : select.value;
      const selected =
        installed?.find(
          (family) => family.toLowerCase() === current.toLowerCase(),
        ) ?? current;
      initial = false;
      select.empty();
      select.createEl("option", { value: "", text: automatic });
      if (selected && !installed?.includes(selected))
        select.createEl("option", {
          value: selected,
          text: installed
            ? `${selected} · Unavailable on this computer`
            : selected,
        });
      const common = (installed ?? []).filter((family) =>
        commonFonts.has(family.toLowerCase()),
      );
      const other = (installed ?? []).filter(
        (family) => !commonFonts.has(family.toLowerCase()),
      );
      for (const families of [common, other]) {
        if (families === other && common.length && other.length)
          select.createEl("hr");
        for (const family of families)
          select.createEl("option", { value: family, text: family });
      }
      select.value = selected;
    };
    populate();
    select.addEventListener("change", () => {
      const value = select.value;
      select.disabled = true;
      void change({ [key]: value })
        .then(() => {
          saved = value;
        })
        .catch((error: unknown) => {
          select.value = saved;
          fail(error);
        })
        .finally(() => {
          select.disabled = false;
        });
    });
    return populate;
  });
  const status = container.createEl("p", {
    cls: "stratum-publish-meta stratum-publish-font-status",
    attr: { role: "status", "aria-live": "polite" },
  });
  status.hidden = true;
  const retry = createStratumButton(container, {
    text: "Retry",
    tooltip: "Retry loading installed fonts",
    className: "stratum-publish-font-retry",
  });
  retry.hidden = true;
  let loading = false;
  const load = () => {
    if (loading) return;
    loading = true;
    retry.hidden = true;
    status.hidden = false;
    status.setText("Loading fonts…");
    void discoverFonts()
      .then((fonts) => {
        if (!container.isConnected) return;
        installed = fonts;
        controls.forEach((populate) => populate());
        status.hidden = true;
      })
      .catch(() => {
        if (!container.isConnected) return;
        status.setText(
          "Could not load installed fonts. Default and saved choices are still available.",
        );
        retry.hidden = false;
      })
      .finally(() => {
        loading = false;
      });
  };
  retry.addEventListener("click", load);
  return load;
}
