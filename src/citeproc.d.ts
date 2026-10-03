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
    setOutputFormat(format: string): void;
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
  const CSL: { Engine: typeof Engine };
  export default CSL;
}
