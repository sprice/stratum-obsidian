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
const PUBLICATION_FILTER = `
function Meta(meta)
  -- The opening is rendered explicitly; do not add Pandoc's automatic title block.
  meta.title = nil
  meta.author = nil
  meta.date = nil
  return meta
end
-- Bare URLs become links, which LaTeX can break across lines. Only top-level
-- text is changed, so existing links are left alone.
local function link_bare_urls(inlines)
  local result = pandoc.Inlines({})
  for _, item in ipairs(inlines) do
    local url, trail
    if item.t == "Str" then
      url, trail = item.text:match("^(https?://%S-)([%.,;:]?)$")
    end
    if url then
      result:insert(pandoc.Link(url, url))
      if trail ~= "" then result:insert(pandoc.Str(trail)) end
    else
      result:insert(item)
    end
  end
  return result
end
-- Tables wider than the text area get proportional columns that wrap.
function Table(el)
  if FORMAT ~= "latex" then return nil end
  for _, spec in ipairs(el.colspecs) do
    if type(spec[2]) == "number" then return nil end
  end
  local rows = {}
  for _, row in ipairs(el.head.rows) do rows[#rows + 1] = row end
  for _, body in ipairs(el.bodies) do
    for _, row in ipairs(body.head) do rows[#rows + 1] = row end
    for _, row in ipairs(body.body) do rows[#rows + 1] = row end
  end
  for _, row in ipairs(el.foot.rows) do rows[#rows + 1] = row end
  local lengths = {}
  for _, row in ipairs(rows) do
    for i, cell in ipairs(row.cells) do
      if cell.col_span ~= 1 then return nil end
      local text = pandoc.utils.stringify(cell.contents)
      lengths[i] = math.max(lengths[i] or 0, utf8.len(text) or #text)
    end
  end
  local natural, weights = 0, 0
  for i = 1, #el.colspecs do
    natural = natural + (lengths[i] or 0) * STRATUM_CHAR_WIDTH + 12
    lengths[i] = math.min(math.max(lengths[i] or 0, 4), 40)
    weights = weights + lengths[i]
  end
  if natural <= STRATUM_TEXT_WIDTH then return nil end
  for i, spec in ipairs(el.colspecs) do
    el.colspecs[i] = {spec[1], lengths[i] / weights}
  end
  return el
end
function Div(el)
  if FORMAT == "latex" and el.classes:includes("csl-entry") then
    for _, block in ipairs(el.content) do
      if block.t == "Plain" or block.t == "Para" then
        block.content = link_bare_urls(block.content)
      end
    end
    return el
  end
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
  // Estimates in points: text width from page and margins, average glyph ~0.5em.
  const page = options.paperSize === "a4" ? 8.27 : 8.5;
  const sizes = `local STRATUM_TEXT_WIDTH = ${(page - 2 * options.margin) * 72}
local STRATUM_CHAR_WIDTH = ${options.bodySize * 0.5}
`;
  return (sizes + PUBLICATION_FILTER)
    .replaceAll(
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
