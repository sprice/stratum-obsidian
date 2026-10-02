/** Keep the manuscript selected while inspecting its literature notes. */
export function shouldFollowSourceDocument(input: {
  pinned: boolean;
  isLiteratureNote: boolean;
  isMarkdown: boolean;
}): boolean {
  return !input.pinned && input.isMarkdown && !input.isLiteratureNote;
}
