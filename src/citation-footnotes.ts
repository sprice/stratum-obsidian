import type { CitationDocument } from "./citation-document";
/** Obsidian keeps the source identifier in data-footref, independently of its display number. */
export function nativeFootnoteReference(
  link: Pick<HTMLElement, "getAttribute" | "textContent">,
  model: CitationDocument,
) {
  const identifier =
    link.getAttribute("data-footref") ?? link.getAttribute("data-footnote-id");
  const note = model.notes.find((note) => note.identifier === identifier);
  const occurrence = Number(
    /\[\d+(?:-(\d+))?\]/.exec(link.textContent ?? "")?.[1] ?? 0,
  );
  const referenceIndex = model.references
    .map((reference, index) => ({ reference, index }))
    .filter(({ reference }) => reference.identifier === identifier)[
    occurrence
  ]?.index;
  if (!note || referenceIndex === undefined)
    throw new Error(
      "Could not map an explanatory footnote. Native notes were retained.",
    );
  return { note, referenceIndex };
}
