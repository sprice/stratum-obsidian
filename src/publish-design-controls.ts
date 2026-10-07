import { Setting } from "obsidian";
import type { PublishOptions } from "./publish-options";
import {
  createStratumDisclosure,
  createStratumSummary,
  styleStratumComponent,
} from "./ui-controls";

/** Publishing sections share native disclosure behavior and a consistent content inset. */
export function createPublicationSection(
  container: HTMLElement,
  title: string,
): {
  details: HTMLDetailsElement;
  body: HTMLDivElement;
} {
  const details = createStratumDisclosure(container, {
    cls: "stratum-publish-section",
  });
  createStratumSummary(details, { text: title });
  const body = details.createDiv({ cls: "stratum-publish-section-body" });
  return { details, body };
}

export function renderPublicationPreview(
  container: HTMLElement,
  options: PublishOptions,
): void {
  container.empty();
  container.addClass("stratum-publish-design-preview");
  container.createEl("p", {
    text: "Layout preview · illustrative",
    cls: "stratum-publish-meta",
  });
  const page = container.createDiv({ cls: "stratum-publish-design-page" });
  page.style.fontFamily = options.bodyFont || "serif";
  page.style.fontSize = `${options.bodySize * 0.65}px`;
  page.style.lineHeight = String(options.lineSpacing);
  page.style.padding = `${options.margin * 16}px`;
  const opening = page.createDiv();
  opening.style.textAlign = options.openingAlignment;
  const title = opening.createDiv({
    text:
      options.titleSource === "properties" ? "Paper title" : "Document heading",
  });
  title.style.fontFamily = options.titleFont || options.bodyFont || "serif";
  title.style.fontSize = `${options.titleSize * 0.6}px`;
  if (options.showAuthors) opening.createDiv({ text: "Author names" });
  if (options.showAffiliations) opening.createDiv({ text: "Affiliations" });
  if (options.showDate) opening.createDiv({ text: "Date" });
  if (options.showAbstract) {
    const abstract = page.createDiv({ cls: "stratum-publish-design-abstract" });
    abstract.style.marginInline =
      options.abstractWidth === "inset" ? "14px" : "0";
    abstract.createEl("strong", { text: "Abstract" });
    abstract.createEl("p", {
      text: "A brief summary of the paper appears here.",
    });
  }
  if (options.showKeywords) page.createEl("p", { text: "Keywords: …" });
  page.createEl("strong", {
    text: options.numberSections ? "1. Introduction" : "Introduction",
  });
  page.createEl("p", {
    text: "The document body follows in a single column, with sections, equations and citations.",
  });
  page.createEl("strong", { text: "References" });
  page.createEl("p", { text: "Cited sources appear at the end." });
}

export function renderPublicationDesign(
  container: HTMLElement,
  options: PublishOptions,
  change: (patch: Partial<PublishOptions>) => Promise<void>,
  fail: (error: unknown) => void,
): () => void {
  const { details: openingSection, body: opening } = createPublicationSection(
    container,
    "Opening",
  );
  let titleSource: HTMLSelectElement | undefined;
  new Setting(opening)
    .setName("Title")
    .setDesc(
      "A generated title requires the note’s title property. An existing body title is preserved.",
    )
    .addDropdown((input) => {
      titleSource = input.selectEl;
      titleSource.setAttribute("aria-label", "Title source");
      return styleStratumComponent(input)
        .addOption("body", "Title already in document")
        .addOption("properties", "Title from note properties · required")
        .setValue(options.titleSource)
        .onChange((value) =>
          change({ titleSource: value as PublishOptions["titleSource"] }).catch(
            fail,
          ),
        );
    });
  new Setting(opening).setName("Opening alignment").addDropdown((input) =>
    styleStratumComponent(input)
      .addOption("left", "Left")
      .addOption("center", "Centered")
      .setValue(options.openingAlignment)
      .onChange((value) =>
        change({
          openingAlignment: value as PublishOptions["openingAlignment"],
        }).catch(fail),
      ),
  );
  for (const [key, name, description] of [
    [
      "showAuthors",
      "Authors",
      "Optional. Read from the authors note property.",
    ],
    [
      "showAffiliations",
      "Affiliations",
      "Optional. Read from the affiliations note property.",
    ],
    ["showDate", "Date", "Optional. Read from the date note property."],
    [
      "showKeywords",
      "Keywords",
      "Optional. Read from the keywords note property and placed after the abstract.",
    ],
  ] as const)
    new Setting(opening)
      .setName(name)
      .setDesc(description)
      .addToggle((input) =>
        styleStratumComponent(input)
          .setValue(options[key])
          .onChange((value) => change({ [key]: value }).catch(fail)),
      );
  const { body: paper } = createPublicationSection(container, "Paper layout");
  paper.createEl("p", {
    text: "Single column. Title, author details, abstract, body and references keep their order.",
    cls: "stratum-publish-meta",
  });
  new Setting(paper).setName("Number sections").addToggle((input) =>
    styleStratumComponent(input)
      .setValue(options.numberSections)
      .onChange((value) => change({ numberSections: value }).catch(fail)),
  );
  new Setting(paper)
    .setName("Abstract")
    .setDesc(
      "Optional. Uses the abstract section in your note. Turning this off omits that section from the published document.",
    )
    .addToggle((input) =>
      styleStratumComponent(input)
        .setValue(options.showAbstract)
        .onChange((value) => change({ showAbstract: value }).catch(fail)),
    );
  new Setting(paper).setName("Abstract width").addDropdown((input) =>
    styleStratumComponent(input)
      .addOption("normal", "Same as body")
      .addOption("inset", "Inset")
      .setValue(options.abstractWidth)
      .onChange((value) =>
        change({
          abstractWidth: value as PublishOptions["abstractWidth"],
        }).catch(fail),
      ),
  );
  // Opens the opening choices, for example to review a repeated title.
  return () => {
    openingSection.open = true;
    titleSource?.scrollIntoView({ block: "center" });
    titleSource?.focus();
  };
}
