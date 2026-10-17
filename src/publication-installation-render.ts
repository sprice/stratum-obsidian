import {
  readTemplateInstallation,
  type TemplateInstallation,
} from "./publication-installation";
import { escapeLatex, type aastexManuscript } from "./publication-package";
import { publicationMathPreamble } from "./publish-math-compat";

/** Only this bundled adapter turns document metadata into TeX. Remote manifests supply bounded choices. */
export function installationLatex(
  value: TemplateInstallation,
  manuscript: ReturnType<typeof aastexManuscript>,
  body: string,
  abstract: string,
  bibliography: boolean,
  preamble = "",
): string {
  const { adapter: a } = readTemplateInstallation(value),
    e = escapeLatex;
  const anonymous =
    a.frontMatter === "acmart" && a.classOptions.includes("anonymous");
  const authorsList = anonymous ? [] : manuscript.authors;
  const prop = (key: string) =>
    e(
      typeof manuscript.properties[key] === "string"
        ? manuscript.properties[key]
        : "",
    );
  const corresponding = anonymous
    ? ""
    : prop("stratum_corresponding_author").trim();
  const isCorresponding = (author: (typeof authorsList)[number]) =>
    !!corresponding && e(author.email.trim()) === corresponding;
  const rawKeywords = manuscript.properties.keywords;
  const keywords = (Array.isArray(rawKeywords) ? rawKeywords : [rawKeywords])
    .filter((word): word is string => typeof word === "string" && !!word.trim())
    .map(e)
    .join(", ");
  const names = authorsList.map((author) => e(author.name));
  const affiliations = [
    ...new Set(
      authorsList
        .flatMap((author) => author.affiliations)
        .filter((v) => v.trim()),
    ),
  ];
  const runningTitle = prop("stratum_running_title") || e(manuscript.title);
  const indices = (author: (typeof authorsList)[number]) =>
    author.affiliations
      .filter((aff) => aff.trim())
      .map((aff) => affiliations.indexOf(aff) + 1)
      .join(",");
  const runningAuthors = anonymous
    ? ""
    : prop("stratum_running_authors") || names.join(", ");
  const title = `\\title${a.frontMatter === "acmart" || a.documentClass === "mnras" ? `[{${runningTitle}}]` : ""}{${e(manuscript.title)}}\n`;
  let authors = "";
  for (const author of authorsList) {
    authors += `\\author{${e(author.name)}}\n`;
    if (a.frontMatter === "acmart") {
      if (isCorresponding(author))
        authors += "\\authornote{Corresponding author.}\n";
      authors += `\\affiliation{\\institution{${e(author.institution || "")}}\\city{${e(author.city || "")}}\\country{${e(author.country || "")}}}\n`;
      authors += author.affiliations
        .filter(
          (aff) => aff.trim() && aff.trim() !== author.institution?.trim(),
        )
        .map((aff) => `\\additionalaffiliation{\\institution{${e(aff)}}}\n`)
        .join("");
    }
    for (const affiliation of author.affiliations) {
      if (a.frontMatter === "aastex5")
        authors += `\\affil{${e(affiliation)}}\n`;
      else if (
        ["aastex7", "revtex", "achemso"].includes(a.frontMatter) ||
        a.documentClass === "quantumarticle"
      )
        authors += `\\affiliation{${e(affiliation)}}\n`;
    }
    if (
      author.email &&
      (["aastex7", "revtex", "acmart", "achemso"].includes(a.frontMatter) ||
        a.documentClass === "quantumarticle")
    )
      authors +=
        a.documentClass === "quantumarticle"
          ? `\\ifdefined\\email\\email{${e(author.email)}}\\else\\affiliation{\\texttt{${e(author.email)}}}\\fi\n`
          : `\\email{${e(author.email)}}\n`;
  }
  if (
    ["standard", "beamer", "eptcs", "elsarticle", "cas"].includes(
      a.frontMatter,
    ) &&
    a.documentClass !== "quantumarticle"
  ) {
    authors = `\\author{${names.join(" \\and ")}}\n`;
    if (a.documentClass === "llncs")
      authors = `\\author{${authorsList.map((author) => `${e(author.name)}\\inst{${indices(author)}}`).join(" \\and ")}}\n\\institute{${affiliations.map(e).join(" \\and ")}${corresponding ? `\\email{${corresponding}}` : ""}}\n`;
    else if (a.frontMatter === "beamer")
      authors += `\\institute{${affiliations.map(e).join(" \\and ")}}\n`;
    else if (a.frontMatter === "elsarticle")
      authors =
        authorsList
          .map(
            (author) =>
              `\\author[${indices(author)}]{${e(author.name)}${isCorresponding(author) ? "\\corref{corresponding}" : ""}}\n${author.email ? `\\ead{${e(author.email)}}\n` : ""}`,
          )
          .join("") +
        affiliations
          .map((aff, index) => `\\address[${index + 1}]{${e(aff)}}\n`)
          .join("") +
        (corresponding
          ? "\\cortext[corresponding]{Corresponding author}\n"
          : "");
    else if (a.frontMatter === "cas")
      authors =
        authorsList
          .map(
            (author) =>
              `\\author[${indices(author)}]{${e(author.name)}}\n${isCorresponding(author) ? "\\cormark[1]\n" : ""}${author.email ? `\\ead{${e(author.email)}}\n` : ""}`,
          )
          .join("") +
        affiliations
          .map(
            (aff, index) =>
              `\\affiliation[${index + 1}]{organization={${e(aff)}}}\n`,
          )
          .join("") +
        (corresponding ? "\\cortext[1]{Corresponding author}\n" : "");
    else if (a.documentClass === "mnras")
      authors = `\\author[{${runningAuthors}}]{${authorsList.map((author) => `${e(author.name)}$^{${indices(author)}}$${isCorresponding(author) ? `\\thanks{Corresponding author: ${e(author.email)}}` : ""}`).join(", ")}\\\\${affiliations.map((aff, index) => `$^{${index + 1}}$${e(aff)}`).join("\\\\")}}\n`;
  }
  if (
    a.frontMatter === "standard" &&
    !["llncs", "mnras", "quantumarticle"].includes(a.documentClass)
  )
    authors = `\\author{${authorsList.map((author) => `${e(author.name)}\\thanks{${e([...author.affiliations, author.email ? `${isCorresponding(author) ? "Corresponding author: " : ""}${author.email}` : ""].filter(Boolean).join("; "))}}`).join(" \\and ")}}\n`;
  // The generic abstract fallback also preserves keywords for classes without
  // a dedicated keyword command. Publisher-specific forms are placed below.
  const nativeKeywords =
    ["acmart", "revtex", "aastex5", "aastex7", "elsarticle", "cas"].includes(
      a.frontMatter,
    ) || ["mnras", "llncs"].includes(a.documentClass);
  let abstractTex = `\\begin{abstract}\n${abstract}\n${keywords && !nativeKeywords ? `\\par\\textbf{Keywords:} ${keywords}\n` : ""}\\end{abstract}\n`;
  if (keywords && a.documentClass === "llncs")
    abstractTex = `\\begin{abstract}\n${abstract}\n\\keywords{${keywords}}\n\\end{abstract}\n`;
  let metadata = title + authors + "\\date{}\n";
  if (a.documentClass === "llncs")
    metadata += `\\titlerunning{${runningTitle}}\n\\authorrunning{${runningAuthors}}\n`;
  let before = "",
    opening = "",
    ending = "";
  switch (a.frontMatter) {
    case "elsarticle":
      opening = `\\begin{frontmatter}\n${metadata}${abstractTex}${keywords ? `\\begin{keyword}${keywords}\\end{keyword}\n` : ""}\\end{frontmatter}\n`;
      break;
    case "cas":
      opening = `${metadata}\\shorttitle{${runningTitle}}\\shortauthors{${runningAuthors}}\n${abstractTex}${keywords ? `\\begin{keywords}${keywords}\\end{keywords}\n` : ""}\\maketitle\n`;
      break;
    case "beamer":
      before = metadata;
      opening =
        "\\begin{frame}\\titlepage\\end{frame}\n\\begin{frame}[allowframebreaks]{Manuscript}\n";
      ending = "\\end{frame}\n";
      break;
    case "eptcs":
      before =
        metadata +
        `\\newcommand{\\titlerunning}{${e(manuscript.title)}}\n\\newcommand{\\authorrunning}{${names.join(", ")}}\n`;
      opening = "\\maketitle\n" + abstractTex;
      break;
    case "achemso":
      before = metadata;
      opening = abstractTex;
      break;
    case "acmart":
      before =
        metadata +
        `\\renewcommand{\\shortauthors}{${runningAuthors}}\n\\settopmatter{printacmref=false}\n\\setcopyright{none}\n\\acmISBN{}\n\\acmDOI{${anonymous ? "" : prop("stratum_acm_doi")}}\n\\acmConference{${prop("stratum_acm_conference")}}{}{}\n\\acmYear{${prop("stratum_acm_year")}}\n\\copyrightyear{${prop("stratum_acm_year")}}\n\\acmBooktitle{}\n`;
      opening =
        abstractTex +
        (keywords ? `\\keywords{${keywords}}\n` : "") +
        "\\maketitle\n";
      break;
    case "revtex":
      opening =
        metadata +
        abstractTex +
        (keywords ? `\\keywords{${keywords}}\n` : "") +
        "\\maketitle\n";
      break;
    case "aastex5":
    case "aastex7":
      opening =
        metadata + abstractTex + (keywords ? `\\keywords{${keywords}}\n` : "");
      break;
    default:
      before = metadata;
      opening = "\\maketitle\n" + abstractTex;
      if (keywords && a.documentClass === "mnras")
        opening += `\\begin{keywords}${keywords}\\end{keywords}\n`;
  }
  const packages = (values: typeof a.packages, command: string) =>
    values
      .map((p) => `\\${command}[${p.options.join(",")}]{${p.name}}`)
      .join("\n");
  // ACM 2.12 used a lowercase font filename. Current Tectonic bundles keep
  // the same font under its canonical case-sensitive filename.
  const legacyAcmFont =
    a.documentClass === "acmart" &&
    value.pin.metadata.upstreamVersion === "2.12";
  const fontAlias = legacyAcmFont
    ? String.raw`\RequirePackage{unicode-math}
\let\stratumsetmathfont\setmathfont
\renewcommand{\setmathfont}[2][]{\stratumsetmathfont[#1]{LibertinusMath-Regular.otf}}`
    : "";

  // Old AASTeX defers its REVTeX title block until the first section. Only
  // that title code needs the kernel commands; body math still needs calc.
  const oldAastex = a.frontMatter === "aastex5";
  const counters = ["setcounter", "addtocounter", "setlength", "addtolength"];
  const saveKernel = oldAastex
    ? counters.map((name) => `\\let\\stratum${name}\\${name}`).join("\n")
    : "";
  const titleCompatibility = oldAastex
    ? counters.map((name) => `\\let\\stratumcalc${name}\\${name}`).join("\n") +
      "\n\\let\\stratummaketitle\\maketitle\n\\renewcommand{\\maketitle}{" +
      counters.map((name) => `\\let\\${name}\\stratum${name}`).join("") +
      "\\stratummaketitle" +
      counters.map((name) => `\\let\\${name}\\stratumcalc${name}`).join("") +
      "}"
    : "";
  // AASTeX's table column counter does not understand the repeated column
  // specification used by amsmath matrices. Math arrays bypass that counter.
  const matrixCompatibility = oldAastex
    ? String.raw`\makeatletter
\let\stratumarray\@array@array@new
\def\@array@array@new[#1]#2{\ifmmode\breaktabtrue\fi\stratumarray[#1]{#2}}
\makeatother`
    : "";
  const references = bibliography
    ? (a.frontMatter === "achemso"
        ? ""
        : `\\bibliographystyle{${a.bibliography}}\n`) +
      "\\bibliography{references}"
    : "";
  return [
    "\\RequirePackage{amssymb}",
    fontAlias,
    packages(a.preload, "RequirePackage"),
    `\\documentclass[${a.classOptions.concat(a.frontMatter === "revtex" && keywords ? ["showkeys"] : []).join(",")}]{${a.documentClass}}`,
    legacyAcmFont ? "\\let\\setmathfont\\stratumsetmathfont" : "",
    a.pdfOutput ? "\\pdfoutput=1" : "",
    packages(a.packages, "usepackage"),
    String.raw`\usepackage{graphicx,amsmath,booktabs,array}
\makeatletter
\@ifclassloaded{revtex4-1}{}{\usepackage{longtable}}
\makeatother
\usepackage{hyperref}`,
    saveKernel,
    publicationMathPreamble,
    titleCompatibility,
    matrixCompatibility,
    preamble,
    String.raw`\providecommand{\tightlist}{}
\newsavebox{\stratumimagebox}
\providecommand{\pandocbounded}[1]{\sbox{\stratumimagebox}{#1}\ifdim\wd\stratumimagebox>\linewidth\resizebox{\linewidth}{!}{\usebox{\stratumimagebox}}\else\usebox{\stratumimagebox}\fi}`,
    before,
    `\\hypersetup{pdftitle={${e(manuscript.title)}},pdfauthor={${names.join(", ")}}}`,
    "\\begin{document}",
    opening,
    body,
    references,
    ending,
    "\\end{document}",
    "",
  ]
    .filter((part) => part !== "")
    .join("\n");
}
