import {
  composeLiteratureNoteBody,
  readLiteratureNoteLayout,
} from "./literature-note-layout";
import { MANAGED_START, MANAGED_END } from "./literature-note-content-types";

// Keep the historical starter fixed even if a future release changes the default.
const ORIGINAL_TEMPLATE = "## My Notes";
export const DEFAULT_NOTES_TEMPLATE = ORIGINAL_TEMPLATE;
export const NOTES_TEMPLATE_KEY = "stratum_notes_template";

export function renderNotesTemplate(template: string): string {
  const text = template.replace(/\r\n/g, "\n");
  return (
    text + (text.endsWith("\n\n") ? "" : text.endsWith("\n") ? "\n" : "\n\n")
  );
}

export function validateNotesTemplate(template: string): string | null {
  if (template.length > 100000 || template.includes("\0"))
    return "Use a template under 100,000 characters without null characters.";
  const personal = renderNotesTemplate(template);
  const layout = readLiteratureNoteLayout(
    composeLiteratureNoteBody(
      personal,
      `${MANAGED_START}\nSource\n${MANAGED_END}\n`,
    ),
    2,
  );
  return layout && !layout.legacy && layout.personal === personal
    ? null
    : "Close any code fences and remove reserved Stratum boundary markers.";
}

export function canReplaceNotesTemplate(
  personal: string,
  recorded: unknown,
): boolean {
  const text = personal.replace(/\r\n/g, "\n");
  if (typeof recorded === "string")
    return text === recorded.replace(/\r\n/g, "\n");
  return !text.trim() || text.trim() === ORIGINAL_TEMPLATE;
}

export function needsNotesTemplateUpdate(
  personal: string,
  recorded: unknown,
  template: string,
): boolean {
  const rendered = renderNotesTemplate(template);
  return (
    canReplaceNotesTemplate(personal, recorded) &&
    (personal.replace(/\r\n/g, "\n") !== rendered || recorded !== rendered)
  );
}
