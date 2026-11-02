/** Bundled engine code shared by all package layouts; never downloaded. */
export const publicationTableFilter = `
local function latex(blocks)
  return (pandoc.write(pandoc.Pandoc(blocks), 'latex'):gsub('\\n+$', ''))
end
function Table(el)
  local cols = #el.colspecs
  local alignments = {}
  local function alignment(value)
    if value == pandoc.AlignRight then return 'r' end
    if value == pandoc.AlignCenter then return 'c' end
    return 'l'
  end
  for _, spec in ipairs(el.colspecs) do table.insert(alignments, alignment(spec[1])) end
  local rows = {}
  local function add(row)
    local cells = {}
    for index, cell in ipairs(row.cells) do
      if cell.col_span ~= 1 or cell.row_span ~= 1 then error('Merged table cells are not supported by journal templates yet.') end
      local content = latex(cell.contents)
      if cell.alignment ~= pandoc.AlignDefault and alignment(cell.alignment) ~= alignments[index] then
        content = '\\\\multicolumn{1}{' .. alignment(cell.alignment) .. '}{' .. content .. '}'
      end
      table.insert(cells, content)
    end
    table.insert(rows, table.concat(cells, ' & ') .. ' \\\\\\\\')
  end
  for _, row in ipairs(el.head.rows) do add(row) end
  if #el.head.rows > 0 then table.insert(rows, '\\\\hline') end
  for _, body in ipairs(el.bodies) do
    for _, row in ipairs(body.head) do add(row) end
    for _, row in ipairs(body.body) do add(row) end
  end
  for _, row in ipairs(el.foot.rows) do add(row) end
  local caption = ''
  if #el.caption.long > 0 then
    caption = '\\\\caption{' .. latex(el.caption.long) .. '}\\n'
  elseif el.caption.short then
    caption = '\\\\caption{' .. latex({pandoc.Plain(el.caption.short)}) .. '}\\n'
  end
  if #alignments ~= cols then error('The journal table has inconsistent column definitions.') end
  return pandoc.RawBlock('latex', '\\\\begin{table}[ht]\\n\\\\centering\\n' .. caption .. '\\\\begin{tabular}{' .. table.concat(alignments) .. '}\\n\\\\hline\\n' .. table.concat(rows, '\\n') .. '\\n\\\\hline\\n\\\\end{tabular}\\n\\\\end{table}')
end
`;
