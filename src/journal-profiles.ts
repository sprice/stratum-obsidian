import { publicationAssetMap } from "./publication-asset-map";
import assets from "./publication-templates/journals/files.json";
import { aastexManuscript, escapeLatex } from "./publication-package";
import { DEFAULT_ACADEMIC_OPTIONS } from "./publish-options";
import type { PublishingTemplate } from "./publish-templates";
import type { PublishingIssue, PublishingProperty } from "./publish-properties";

export type JournalFamily =
  | "acm"
  | "ieee"
  | "revtex"
  | "elsevier"
  | "cas"
  | "mnras"
  | "aa"
  | "lncs"
  | "jmlr"
  | "research";
export interface JournalProfile {
  id: string;
  family: JournalFamily;
  name: string;
  label: string;
  upstreamVersion: string;
  version: string;
  compiler: "tectonic";
  outputs: ["pdf"];
  dependencies: string[];
  provenance: string;
  class: string;
  classOptions: string[];
  bibliography: string;
  citations: "numeric" | "author-year";
  anonymous?: boolean;
  blocker?: string;
}
const profiles: JournalProfile[] = [];
function add(
  family: JournalFamily,
  name: string,
  upstreamVersion: string,
  cls: string,
  bibliography: string,
  modes: [string, string, string[], "numeric" | "author-year", boolean?][],
) {
  for (const [id, label, classOptions, citations, anonymous] of modes)
    profiles.push({
      id: `journal:${family}-${id}`,
      family,
      name,
      label,
      upstreamVersion,
      version: "1.0.0",
      compiler: "tectonic",
      outputs: ["pdf"],
      dependencies: [
        "graphicx",
        "amsmath",
        "amssymb",
        "natbib",
        "hyperref",
        "booktabs",
        "array",
        "longtable",
      ],
      provenance:
        family === "research"
          ? "Original Stratum preset"
          : "publication-templates/journals/provenance.json",
      class: cls,
      bibliography,
      classOptions,
      citations,
      anonymous,
    });
}
add("acm", "ACM", "2.20", "acmart", "ACM-Reference-Format", [
  ["conference", "Conference · sigconf", ["sigconf"], "numeric"],
  ["journal", "Journal · acmsmall", ["acmsmall"], "numeric"],
  [
    "review",
    "Anonymous review",
    ["manuscript", "review", "anonymous"],
    "numeric",
    true,
  ],
]);
add("ieee", "IEEE", "1.8b", "IEEEtran", "IEEEtran", [
  ["journal", "Journal", ["journal"], "numeric"],
  ["conference", "Conference", ["conference"], "numeric"],
]);
add("revtex", "APS / AIP", "4.2f", "revtex4-2", "apsrev4-2", [
  ["aps-preprint", "APS · preprint", ["aps", "pra", "preprint"], "numeric"],
  ["aps-reprint", "APS · reprint", ["aps", "pra", "reprint"], "numeric"],
  [
    "aip-numeric",
    "AIP · numerical",
    ["aip", "jcp", "reprint", "numerical"],
    "numeric",
  ],
  [
    "aip-author-year",
    "AIP · author-year",
    ["aip", "jcp", "preprint", "author-year"],
    "author-year",
  ],
]);
for (const [mode, options] of [
  ["preprint", ["preprint"]],
  ["review", ["review"]],
  ["journal", ["5p", "twocolumn"]],
] as const)
  for (const citation of ["numeric", "author-year"] as const)
    add(
      "elsevier",
      "Elsevier",
      "3.5",
      "elsarticle",
      citation === "numeric" ? "elsarticle-num-names" : "elsarticle-harv",
      [
        [
          `${mode}-${citation}`,
          `${mode[0].toUpperCase()}${mode.slice(1)} · ${citation}`,
          [...options, citation === "numeric" ? "numbers" : "authoryear"],
          citation,
        ],
      ],
    );
add("cas", "Elsevier CAS", "2.4", "cas-sc", "cas-model2-names", [
  ["single", "Single column", [], "author-year"],
  ["double", "Double column", [], "author-year"],
]);
add("mnras", "MNRAS", "3.2", "mnras", "mnras", [
  ["standard", "Standard manuscript", ["usenatbib"], "author-year"],
  ["referee", "Referee", ["referee", "usenatbib"], "author-year"],
]);
add("lncs", "Springer LNCS", "2.26", "llncs", "splncs04", [
  ["proceedings", "Proceedings", ["runningheads"], "numeric"],
]);
add("research", "Research / preprint", "1.0.0", "article", "plainnat", [
  ["single", "Single column", ["11pt"], "author-year"],
  ["double", "Double column", ["10pt", "twocolumn"], "author-year"],
]);
add("aa", "Astronomy & Astrophysics", "pending", "aa", "aa", [
  ["standard", "Standard article", [], "author-year"],
  ["referee", "Referee", ["referee"], "author-year"],
]);
add("jmlr", "JMLR", "pending", "article", "plainnat", [
  ["journal", "Journal manuscript", [], "author-year"],
  ["preprint", "Preprint", [], "author-year"],
]);
for (const p of profiles) {
  if (p.family === "cas" && p.id.endsWith("double")) p.class = "cas-dc";
  if (p.id.endsWith("aip-numeric")) p.bibliography = "aipnum4-2";
  if (p.id.endsWith("aip-author-year")) p.bibliography = "aipauth4-2";
  if (p.family === "aa")
    p.blocker =
      "Astronomy & Astrophysics is unavailable until the official assets and their distribution permissions are verified.";
  if (p.family === "jmlr")
    p.blocker =
      "JMLR is unavailable until redistribution permission for the official jmlr2e.sty is established. The distinct CTAN jmlr class is not a substitute.";
}
for (const profile of profiles) {
  Object.freeze(profile.classOptions);
  Object.freeze(profile.dependencies);
  Object.freeze(profile.outputs);
  Object.freeze(profile);
}
Object.freeze(profiles);
export const JOURNAL_PROFILES: readonly JournalProfile[] = profiles;
export function journalProfile(id?: string) {
  return profiles.find((p) => p.id === id);
}
export function journalReference(p: JournalProfile) {
  return {
    id: p.id.replace(":", "-"),
    version: p.version,
    upstreamVersion: p.upstreamVersion,
  };
}
export function journalFiles(
  profile: JournalProfile,
  value: unknown = assets,
): Record<string, string> {
  const files: Record<string, string> = {};
  for (const [path, contents] of Object.entries(publicationAssetMap(value))) {
    if (
      !path.startsWith(`${profile.family}/`) ||
      !/\.(cls|sty|rtx|bst)$/.test(path)
    )
      continue;
    const name = path.split("/").at(-1)!;
    if (Object.hasOwn(files, name))
      throw new Error("Journal asset names collide.");
    files[name] = contents;
  }
  if (
    !profile.blocker &&
    profile.family !== "research" &&
    (!files[`${profile.class}.cls`] || !files[`${profile.bibliography}.bst`])
  )
    throw new Error(`Required ${profile.name} assets are missing.`);
  return files;
}
export const JOURNAL_TEMPLATES: PublishingTemplate[] = profiles
  .filter((p) => !p.blocker)
  .map((p) => ({
    id: p.id,
    name: p.name,
    documentType: "academic",
    renderer: "journal",
    version: {
      familyId: `journal:${p.family}`,
      label: `${p.label} · ${p.upstreamVersion}`,
    },
    layout: {
      ...DEFAULT_ACADEMIC_OPTIONS,
      titleSource: "body",
      showDate: false,
      bodyFont: "",
      titleFont: "",
    },
    properties: [],
    prefill: { authors: [], affiliations: [], date: "", keywords: [] },
  }));
export function journalProperties(
  profile: JournalProfile,
): PublishingProperty[] {
  const keys = ["stratum_corresponding_author"];
  if (["acm", "cas", "mnras", "lncs"].includes(profile.family))
    keys.push("stratum_running_title", "stratum_running_authors");
  if (profile.family === "acm")
    keys.push("stratum_acm_conference", "stratum_acm_year", "stratum_acm_doi");
  return keys.map((key) => ({
    key,
    type: "text",
    required: false,
    defaultValue: "",
    use: "metadata",
  }));
}
export function journalProblems(
  text: string,
  titleSource: "body" | "properties",
  profile: JournalProfile,
  includeKeywords = true,
) {
  const manuscript = aastexManuscript(text, titleSource);
  if (!includeKeywords)
    manuscript.properties = { ...manuscript.properties, keywords: undefined };
  const issues: PublishingIssue[] = [];
  const problem = (message: string, target: "title" | "general" = "general") =>
    issues.push({ target, message, blocking: true });
  if (profile.blocker) problem(profile.blocker);
  if (!manuscript.title)
    problem("Add a manuscript title using the selected title source.", "title");
  if (!profile.anonymous && !manuscript.authors.length)
    problem("Add at least one author.");
  for (const [author, value] of manuscript.authors.entries()) {
    if (profile.anonymous) break;
    for (const field of ["name", "affiliations"] as const)
      if (
        field === "name"
          ? !value.name.trim()
          : !value.affiliations.some((a) => a.trim())
      )
        issues.push({
          target: "author",
          author,
          field,
          message: `Author ${author + 1} needs ${field === "name" ? "a name" : "an affiliation"}.`,
          blocking: true,
        });
    if (
      profile.family === "acm" &&
      (!value.institution?.trim() ||
        !value.city?.trim() ||
        !value.country?.trim())
    )
      issues.push({
        target: "author",
        author,
        field: "affiliations",
        message: `Author ${author + 1}: enter institution, city and country for ACM.`,
        blocking: true,
      });
  }
  if (!manuscript.abstract)
    problem("Add one Abstract section before publishing this manuscript.");
  for (const field of journalProperties(profile))
    if (
      manuscript.properties[field.key] !== undefined &&
      typeof manuscript.properties[field.key] !== "string"
    )
      problem(`${field.key} must be text.`);
  const keywords = manuscript.properties.keywords;
  if (
    keywords !== undefined &&
    !(
      typeof keywords === "string" ||
      (Array.isArray(keywords) &&
        keywords.every((value) => typeof value === "string"))
    )
  )
    problem("Keywords must be text or a list of text values.");
  const year = manuscript.properties.stratum_acm_year;
  if (
    profile.family === "acm" &&
    typeof year === "string" &&
    year.trim() &&
    !/^\d{4}$/.test(year)
  )
    problem("The publication year must be a four-digit year.");
  const corresponding = manuscript.properties.stratum_corresponding_author;
  if (
    typeof corresponding === "string" &&
    corresponding.trim() &&
    !manuscript.authors.some((a) => a.email.trim() === corresponding.trim())
  )
    problem("The corresponding author must match an author's email address.");
  return { manuscript, issues };
}
export function journalLatex(
  profile: JournalProfile,
  manuscript: ReturnType<typeof aastexManuscript>,
  body: string,
  abstract: string,
  bibliography: boolean,
  preamble = "",
): string {
  if (profile.blocker) throw new Error(profile.blocker);
  if (
    !JOURNAL_PROFILES.some(
      (installed) =>
        installed.id === profile.id &&
        installed.class === profile.class &&
        installed.family === profile.family &&
        installed.version === profile.version &&
        installed.upstreamVersion === profile.upstreamVersion &&
        installed.blocker === profile.blocker &&
        installed.compiler === profile.compiler &&
        installed.bibliography === profile.bibliography &&
        installed.classOptions.join(",") === profile.classOptions.join(","),
    )
  )
    throw new Error("Unsupported journal profile or renderer.");
  const e = escapeLatex;
  const prop = (key: string) => {
    if (
      profile.anonymous &&
      [
        "stratum_running_authors",
        "stratum_corresponding_author",
        "stratum_acm_doi",
      ].includes(key)
    )
      return "";
    return e(
      typeof manuscript.properties[key] === "string"
        ? manuscript.properties[key]
        : "",
    );
  };
  const title = e(manuscript.title);
  const authors = profile.anonymous ? [] : manuscript.authors;
  const names = authors.map((a) => e(a.name));
  const affiliations = [
    ...new Set(authors.flatMap((a) => a.affiliations.filter((v) => v.trim()))),
  ];
  const indices = (a: (typeof authors)[number]) =>
    a.affiliations
      .filter((v) => v.trim())
      .map((v) => affiliations.indexOf(v) + 1)
      .join(",");
  const rawKeywords = manuscript.properties.keywords;
  const keywords = (
    Array.isArray(rawKeywords)
      ? rawKeywords
      : typeof rawKeywords === "string"
        ? [rawKeywords]
        : []
  )
    .filter((k): k is string => typeof k === "string")
    .map(e)
    .join(", ");
  let metadata = `\\title{${title}}\n`,
    extra = "",
    opening = "\\maketitle\n",
    abstractTex = `\\begin{abstract}\n${abstract}\n\\end{abstract}\n`;
  const rawCorresponding = manuscript.properties.stratum_corresponding_author;
  const corresponding =
    typeof rawCorresponding === "string" ? rawCorresponding.trim() : "";
  const isCorresponding = (author: (typeof authors)[number]) =>
    !!corresponding && author.email.trim() === corresponding;
  if (profile.family === "acm") {
    metadata = `\\title[${prop("stratum_running_title") || title}]{${title}}\n`;
    extra =
      "\\renewcommand{\\shortauthors}{" +
      (prop("stratum_running_authors") || names.join(", ")) +
      "}\n\\setcopyright{none}\n\\settopmatter{printacmref=false}\n\\acmISBN{}\n\\acmDOI{" +
      prop("stratum_acm_doi") +
      "}\n\\acmConference{" +
      prop("stratum_acm_conference") +
      "}{}{}\n\\acmYear{" +
      prop("stratum_acm_year") +
      "}\n\\copyrightyear{" +
      prop("stratum_acm_year") +
      "}\n\\acmBooktitle{}\n";
    metadata += authors
      .map(
        (a) =>
          `\\author{${e(a.name)}}\n${isCorresponding(a) ? "\\authornote{Corresponding author.}\n" : ""}${a.email ? `\\email{${e(a.email)}}\n` : ""}\\affiliation{\\institution{${e(a.institution ?? "")}}\\city{${e(a.city ?? "")}}\\country{${e(a.country ?? "")}}}${a.affiliations
            .filter(
              (value) => value.trim() && value.trim() !== a.institution?.trim(),
            )
            .map(
              (value) => `\\additionalaffiliation{\\institution{${e(value)}}}`,
            )
            .join("\n")}`,
      )
      .join("\n");
    opening =
      abstractTex + (keywords ? `\\keywords{${keywords}}\n` : "") + opening;
    abstractTex = "";
  } else if (profile.family === "revtex") {
    metadata += authors
      .map(
        (a) =>
          `\\author{${e(a.name)}}\n${isCorresponding(a) ? `\\email{${e(a.email)}}\n` : ""}${a.affiliations.map((v) => `\\affiliation{${e(v)}}`).join("\n")}`,
      )
      .join("\n");
    if (keywords) metadata += `\n\\keywords{${keywords}}\n`;
    opening = abstractTex + opening;
    abstractTex = "";
  } else if (profile.family === "elsevier" || profile.family === "cas") {
    metadata += authors
      .map(
        (a) =>
          `\\author[${indices(a)}]{${e(a.name)}}\n${a.email ? `\\ead{${e(a.email)}}\n` : ""}${isCorresponding(a) ? "\\corref{corresponding}\n" : ""}`,
      )
      .join("\n");
    metadata +=
      "\n" +
      affiliations
        .map((v, i) => `\\affiliation[${i + 1}]{organization={${e(v)}}}`)
        .join("\n");
    if (corresponding)
      metadata += `\n\\cortext[corresponding]{Corresponding author}`;
    if (profile.family === "elsevier") {
      opening =
        "\\begin{frontmatter}\n" +
        metadata +
        "\n" +
        abstractTex +
        (keywords ? `\\begin{keyword}${keywords}\\end{keyword}\n` : "") +
        "\\end{frontmatter}\n";
      metadata = "";
      abstractTex = "";
    } else {
      opening =
        metadata +
        "\n" +
        abstractTex +
        (keywords ? `\\begin{keywords}${keywords}\\end{keywords}\n` : "") +
        "\\maketitle\n";
      metadata = "";
      abstractTex = "";
    }
    if (profile.family === "cas")
      extra +=
        `\\shorttitle{${prop("stratum_running_title") || title}}\n\\shortauthors{${prop("stratum_running_authors") || names.join(", ")}}\n` +
        "\\renewcommand{\\ttdefault}{lmtt}\n" +
        "\\ExplSyntaxOn\\keys_set:nn{stm/mktitle}{nologo=true}\\ExplSyntaxOff\n";
  } else if (profile.family === "lncs") {
    metadata += `\\author{${authors.map((a) => `${e(a.name)}\\inst{${indices(a)}}`).join(" \\and ")}}\n\\institute{${affiliations.map(e).join(" \\and ")}${corresponding ? `\\email{${e(corresponding)}}` : ""}}\n`;
    metadata += `\\titlerunning{${prop("stratum_running_title") || title}}\n\\authorrunning{${prop("stratum_running_authors") || names.join(", ")}}\n`;
    abstractTex = `\\begin{abstract}\n${abstract}\n${keywords ? `\\keywords{${keywords}}` : ""}\n\\end{abstract}\n`;
  } else if (profile.family === "mnras") {
    metadata = `\\title[${prop("stratum_running_title") || title}]{${title}}\n\\author[${prop("stratum_running_authors") || names.join(", ")}]{${authors.map((a) => `${e(a.name)}$^{${indices(a)}}$${isCorresponding(a) ? `\\thanks{Corresponding author: ${e(a.email)}}` : ""}`).join(", ")}\\\\\n${affiliations.map((v, i) => `$^{${i + 1}}$${e(v)}`).join("\\\\\n")}}\n\\date{}\n\\pubyear{}\n`;
    extra +=
      "\\makeatletter\\def\\ps@stratum{\\let\\@mkboth\\@gobbletwo\\def\\@oddhead{}\\def\\@evenhead{}\\def\\@oddfoot{\\hfil\\thepage\\hfil}\\let\\@evenfoot\\@oddfoot}\\makeatother\n";
    opening += "\\pagestyle{stratum}\\thispagestyle{stratum}\n";
    abstractTex += keywords
      ? `\\begin{keywords}${keywords}\\end{keywords}\n`
      : "";
  } else if (profile.family === "ieee" && profile.id.endsWith("conference")) {
    metadata += `\\author{${authors.map((a) => `\\IEEEauthorblockN{${e(a.name)}}\\IEEEauthorblockA{${a.affiliations.map(e).join("\\\\")} ${a.email ? `\\\\${e(a.email)}` : ""}${isCorresponding(a) ? "\\\\Corresponding author" : ""}}`).join("\\and\n")}}\n`;
    abstractTex += keywords
      ? `\\begin{IEEEkeywords}${keywords}\\end{IEEEkeywords}\n`
      : "";
  } else {
    metadata += `\\author{${authors.map((a) => `${e(a.name)}${a.affiliations.length ? `\\thanks{${a.affiliations.map(e).join("; ")}${isCorresponding(a) ? `; Corresponding author: ${e(a.email)}` : ""}}` : ""}`).join(profile.family === "ieee" ? ", " : " \\and ")}}\n\\date{}\n`;
    if (profile.family === "ieee")
      abstractTex += keywords
        ? `\\begin{IEEEkeywords}${keywords}\\end{IEEEkeywords}\n`
        : "";
  }
  if (profile.family === "research" && keywords)
    abstractTex = `\\begin{abstract}\n${abstract}\n\\par\\textbf{Keywords:} ${keywords}\n\\end{abstract}\n`;
  let packages =
    "\\usepackage{graphicx,amsmath,amssymb,longtable,booktabs,array}\n\\usepackage{hyperref}\n";
  if (
    profile.family === "research" ||
    profile.family === "lncs" ||
    profile.family === "cas"
  )
    packages += `\\usepackage[${profile.citations === "numeric" ? "numbers" : "authoryear"}]{natbib}\n`;
  if (profile.family === "ieee")
    packages += "\\usepackage[numbers,sort&compress]{natbib}\n";
  const identity = profile.anonymous ? "" : names.join(", ");
  return `\\documentclass[${profile.classOptions.concat(profile.family === "revtex" && keywords ? ["showkeys"] : []).join(",")}]{${profile.class}}\n${packages}${preamble}\n\\typeout{Stratum journal adapter: partial upstream distribution; see bundled notices for complete sources.}\n\\providecommand{\\tightlist}{}\n\\newsavebox{\\stratumimagebox}\n\\providecommand{\\pandocbounded}[1]{\\sbox{\\stratumimagebox}{#1}\\ifdim\\wd\\stratumimagebox>\\linewidth\\resizebox{\\linewidth}{!}{\\usebox{\\stratumimagebox}}\\else\\usebox{\\stratumimagebox}\\fi}\n${extra}${profile.family === "revtex" ? "" : metadata}\n\\hypersetup{hidelinks,pdftitle={${title}},pdfauthor={${identity}}}\n\\begin{document}\n${profile.family === "revtex" ? metadata : ""}${opening}${abstractTex}${body}\n${bibliography ? `\\bibliographystyle{${profile.bibliography}}\n\\bibliography{references}` : ""}\n\\end{document}\n`;
}
