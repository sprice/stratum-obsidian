import type { PublishOptions } from "./publish-options";
export function publicationHeader(options: PublishOptions): string {
  const title = options.titleFont || options.bodyFont;
  return `\n${title ? `\\newfontfamily\\stratumtitlefont{${title}}` : "\\let\\stratumtitlefont\\rmfamily"}
\\newcommand{\\stratumtitle}{\\stratumtitlefont\\fontsize{${options.titleSize}}{${options.titleSize * 1.2}}\\selectfont}
\\usepackage{titlesec}
\\titleformat{\\section}{\\normalfont\\bfseries\\fontsize{${options.bodySize * 1.35}}{${options.bodySize * 1.6}}\\selectfont}{\\thesection}{1em}{}
\\titleformat{\\subsection}{\\normalfont\\bfseries\\fontsize{${options.bodySize * 1.15}}{${options.bodySize * 1.4}}\\selectfont}{\\thesubsection}{1em}{}
\\AtBeginDocument{\\fontsize{${options.bodySize}}{${options.bodySize * 1.2}}\\selectfont}
\\pagestyle{plain}
`;
}
/** Semantic opening blocks use Word paragraph styles or native LaTeX layout. */
export const PUBLICATION_FILTER = `
function Meta(meta)
  -- The opening is rendered explicitly; do not add Pandoc's automatic title block.
  meta.title = nil
  meta.author = nil
  meta.date = nil
  return meta
end
function Div(el)
  local styles = {
    ["stratum-publish-title"] = "Title",
    ["stratum-publish-authors"] = "Author",
    ["stratum-publish-affiliation"] = "Subtitle",
    ["stratum-publish-date"] = "Date",
    ["stratum-publish-abstract"] = "Abstract",
    ["stratum-publish-keywords"] = "Body Text"
  }
  local style = nil
  for _, class in ipairs(el.classes) do if styles[class] then style = styles[class] end end
  if not style then return nil end
  if FORMAT == "docx" then
    el.attributes["custom-style"] = style
    return el
  elseif FORMAT == "latex" then
    if style == "Abstract" then
      table.insert(el.content, 1, pandoc.RawBlock("latex", "\\\\begin{quote}"))
      table.insert(el.content, pandoc.RawBlock("latex", "\\\\end{quote}"))
    elseif style ~= "Body Text" then
      local before = "\\\\begin{center}"
      if style == "Title" then before = before .. "\\\\stratumtitle" end
      table.insert(el.content, 1, pandoc.RawBlock("latex", before))
      table.insert(el.content, pandoc.RawBlock("latex", "\\\\end{center}"))
    end
    return el.content
  end
end
`;

export function publicationFilter(options: PublishOptions): string {
  return PUBLICATION_FILTER.replaceAll(
    "begin{center}",
    `begin{${options.openingAlignment === "left" ? "flushleft" : "center"}}`,
  )
    .replaceAll(
      "end{center}",
      `end{${options.openingAlignment === "left" ? "flushleft" : "center"}}`,
    )
    .replaceAll(
      "begin{quote}",
      options.abstractWidth === "inset" ? "begin{quote}" : "begingroup",
    )
    .replaceAll(
      "end{quote}",
      options.abstractWidth === "inset" ? "end{quote}" : "endgroup",
    );
}
