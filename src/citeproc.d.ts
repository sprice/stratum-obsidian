declare module "citeproc" {
  export interface Citation {
    citationID: string;
    citationItems: {
      id: string;
      locator?: string;
      label?: string;
      prefix?: string;
      suffix?: string;
      "suppress-author"?: boolean;
    }[];
    properties: { noteIndex: number; mode?: string; infix?: string };
  }
  export class Engine {
    constructor(
      sys: {
        retrieveLocale: (lang: string) => string | false;
        retrieveItem: (id: string) => unknown;
      },
      style: string,
      lang?: string,
      forceLang?: boolean,
    );
    opt: { xclass: string; development_extensions: Record<string, boolean> };
    /** Per-render diagnostics accumulated by the internal rendering hook. */
    tmp: { citation_errors: unknown[] };
    setOutputFormat(format: string): void;
    /** Internal rendering hook used by processCitationCluster. */
    process_CitationCluster(sortedItems: unknown, citation: Citation): string;
    processCitationCluster(
      citation: Citation,
      before: [string, number][],
      after: [string, number][],
    ): [unknown, [number, string, string?][]];
    rebuildProcessorState(
      citations: Citation[],
      mode: string,
      uncited: string[],
    ): [string, number, string][];
    makeBibliography():
      | false
      | [
          {
            hangingindent: boolean;
            linespacing: number;
            entryspacing: number;
            bibstart: string;
            bibend: string;
            bibliography_errors: unknown[];
          },
          string[],
        ];
  }
  const CSL: { Engine: typeof Engine; LANG_BASES: Record<string, string> };
  export default CSL;
}
