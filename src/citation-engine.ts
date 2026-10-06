import CSL, { type Citation } from "citeproc";

/** Keep a valid empty author-suppressed form empty at the processor boundary. */
export class CitationEngine extends CSL.Engine {
  // citeproc 2.4.63 uses this hook for both new and reprocessed citations.
  // Its composite implementation unconditionally renders a suppressed half,
  // which can legitimately have no content in author/locator styles like MLA.
  override process_CitationCluster(
    sortedItems: unknown,
    citation: Citation,
  ): string {
    const mode = citation.properties.mode;
    // Stratum requests composite citations without an infix. Keep citeproc's
    // punctuation handling if a future caller supplies one.
    if (mode === "composite" && !citation.properties.infix) {
      try {
        citation.properties.mode = "author-only";
        const author = super.process_CitationCluster(sortedItems, citation);
        citation.properties.mode = "suppress-author";
        const remainder = this.renderSuppressed(sortedItems, citation);
        return [author, remainder].filter(Boolean).join(" ");
      } finally {
        citation.properties.mode = mode;
      }
    }
    if (
      mode === "suppress-author" ||
      (citation.citationItems.length > 0 &&
        citation.citationItems.every((item) => item["suppress-author"]))
    )
      return this.renderSuppressed(sortedItems, citation);
    return super.process_CitationCluster(sortedItems, citation);
  }

  private renderSuppressed(sortedItems: unknown, citation: Citation): string {
    const extensions = this.opt.development_extensions;
    const previous = extensions.throw_on_empty;
    const errorsBefore = this.tmp.citation_errors.length;
    extensions.throw_on_empty = true;
    try {
      return super.process_CitationCluster(sortedItems, citation);
    } catch (error) {
      // The pinned processor throws this string through CSL.error when its
      // output is empty. It does not attach the documented ECSEMPTY code.
      if (error === "citeproc-js error: Citation would render no content") {
        // Suppressing printed names is valid; missing style variables are not.
        // citeproc records the latter as source-formatting diagnostics before
        // its empty-output signal. Do not silently discard a failed citation.
        if (this.tmp.citation_errors.length > errorsBefore)
          throw new Error(
            "This citation style could not format a source. Check its metadata or choose another style.",
          );
        return "";
      }
      throw error;
    } finally {
      extensions.throw_on_empty = previous;
    }
  }
}
