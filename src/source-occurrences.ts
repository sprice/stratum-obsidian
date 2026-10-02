/** Offsets always refer to the original Markdown, including unsaved editor text. */
export interface SourceOccurrence {
  kind: "citation" | "link";
  target: string;
  from: number;
  to: number;
  excerpt: string;
}

function escaped(text: string, offset: number): boolean {
  let slashes = 0;
  while (offset > 0 && text[--offset] === "\\") slashes++;
  return slashes % 2 === 1;
}

/** Mask non-prose without changing UTF-16 offsets used by the editor. */
function prose(text: string): string {
  const chars = text.split("");
  const mask = (start: number, end: number) => {
    for (let i = start; i < end; i++) if (chars[i] !== "\n") chars[i] = " ";
  };
  const frontmatter =
    /^(?:\uFEFF)?---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)(?:\r?\n|$)/.exec(text);
  if (frontmatter) mask(0, frontmatter[0].length);
  // Comments and fenced code may contain otherwise valid-looking citations.
  for (const match of text.matchAll(
    /<!--[\s\S]*?(?:-->|$)|%%[\s\S]*?(?:%%|$)/g,
  ))
    mask(match.index, match.index + match[0].length);
  let fence: { char: string; size: number; start: number } | null = null;
  let offset = 0;
  for (const line of chars.join("").split("\n")) {
    const marker = /^\s*(?:>\s*)*(`{3,}|~{3,})(.*)$/.exec(line);
    if (marker) {
      if (!fence)
        fence = { char: marker[1][0], size: marker[1].length, start: offset };
      else if (
        marker[1][0] === fence.char &&
        marker[1].length >= fence.size &&
        !marker[2].trim()
      ) {
        mask(fence.start, offset + line.length);
        fence = null;
      }
    }
    offset += line.length + 1;
  }
  if (fence) mask(fence.start, text.length);
  for (const match of chars
    .join("")
    .matchAll(/<(pre|code|script|style)\b[^>]*>[\s\S]*?(?:<\/\1>|$)/gi))
    mask(match.index, match.index + match[0].length);
  const fenced = chars.join("");
  for (let i = 0; i < fenced.length; i++) {
    if (fenced[i] !== "`" || escaped(fenced, i)) continue;
    let end = i;
    while (fenced[end] === "`") end++;
    const ticks = fenced.slice(i, end);
    let close = fenced.indexOf(ticks, end);
    while (
      close >= 0 &&
      (fenced[close - 1] === "`" || fenced[close + ticks.length] === "`")
    )
      close = fenced.indexOf(ticks, close + ticks.length);
    if (close >= 0) {
      mask(i, close + ticks.length);
      i = close + ticks.length - 1;
    }
  }
  // Use original indentation: masking inline code must not create code blocks.
  // Indented code is ignored, except continuation paragraphs of footnotes.
  let inFootnote = false;
  const listColumns: number[] = [];
  offset = 0;
  for (const raw of text.split("\n")) {
    const line = raw.replace(/^(?: {0,3}> ?)+/, "").replace(/\t/g, "    ");
    const indent = /^ */.exec(line)![0].length;
    const item = /^( *)(?:[-+*]|\d+[.)]) +/.exec(line);
    if (/^ {0,3}\[\^[^\]]+\]:/.test(line)) inFootnote = true;
    else if (line.trim() && indent < 4) inFootnote = false;
    if (line.trim()) {
      while (listColumns.length && indent < listColumns[listColumns.length - 1])
        listColumns.pop();
      if (item && (indent < 4 || listColumns.length))
        listColumns.push(item[0].length);
    }
    const base = inFootnote ? 4 : (listColumns[listColumns.length - 1] ?? 0);
    if (indent >= base + 4 && line.trim()) mask(offset, offset + raw.length);
    offset += raw.length + 1;
  }
  return chars.join("");
}

function excerpt(text: string, from: number, to: number): string {
  const start = Math.max(text.lastIndexOf("\n", from - 1) + 1, from - 75);
  const newline = text.indexOf("\n", to);
  const end = Math.min(newline < 0 ? text.length : newline, to + 100);
  return text.slice(start, end).trim();
}

export function parseSourceOccurrences(text: string): SourceOccurrence[] {
  let visible = prose(text);
  const occurrences: SourceOccurrence[] = [];
  const mask = (from: number, to: number) => {
    visible =
      visible.slice(0, from) +
      visible.slice(from, to).replace(/[^\n]/g, " ") +
      visible.slice(to);
  };
  const add = (
    kind: SourceOccurrence["kind"],
    target: string,
    from: number,
    to: number,
  ) => {
    occurrences.push({
      kind,
      target,
      from,
      to,
      excerpt: excerpt(text, from, to),
    });
  };
  const definitions = new Map<string, string>();
  const normalizeLabel = (label: string) =>
    label.trim().replace(/\s+/g, " ").toLowerCase();
  for (const match of visible.matchAll(
    /^ {0,3}\[([^\]^][^\]]*)\]:\s*(<[^>]+>|\S+).*$/gm,
  )) {
    definitions.set(normalizeLabel(match[1]), match[2].replace(/^<|>$/g, ""));
    mask(match.index, match.index + match[0].length);
  }
  for (const match of visible.matchAll(/!?\[\[((?:\\.|[^\]\n])+)\]\]/g)) {
    if (escaped(visible, match.index)) {
      mask(match.index, match.index + match[0].length);
      continue;
    }
    const target = match[1]
      .split(/(?<!\\)\|/, 1)[0]
      .replace(/\\([|\]])/g, "$1");
    add("link", target, match.index, match.index + match[0].length);
    mask(match.index, match.index + match[0].length);
  }
  // Balanced destinations allow ordinary Markdown links with parentheses.
  for (let i = 0; i < visible.length; i++) {
    if (visible[i] !== "[" || escaped(visible, i)) continue;
    const close = visible.indexOf("]", i + 1);
    if (close < 0) break;
    const label = visible.slice(i + 1, close);
    let target: string | undefined;
    let end = close + 1;
    if (visible[end] === "(") {
      let depth = 1;
      let j = end + 1;
      for (; j < visible.length && depth; j++) {
        if (escaped(visible, j)) continue;
        if (visible[j] === "(") depth++;
        if (visible[j] === ")") depth--;
      }
      if (depth) continue;
      const destination = visible.slice(end + 1, j - 1).trim();
      target = destination.startsWith("<")
        ? destination.slice(1, destination.indexOf(">"))
        : destination.split(/\s+["']/)[0];
      end = j;
    } else if (visible[end] === "[") {
      const refEnd = visible.indexOf("]", end + 1);
      if (refEnd < 0) continue;
      target = definitions.get(
        normalizeLabel(visible.slice(end + 1, refEnd) || label),
      );
      end = refEnd + 1;
    } else target = definitions.get(normalizeLabel(label));
    if (target !== undefined) {
      add("link", target.replace(/\\([()])/g, "$1"), i, end);
      mask(i, end);
      i = end - 1;
    }
  }
  // Autolinks, URLs and HTML attributes are not citation text.
  for (const match of visible.matchAll(
    /<[^>\n]*>|\b(?:https?:\/\/|mailto:)[^\s<>]+/g,
  ))
    mask(match.index, match.index + match[0].length);
  const keyPattern =
    /@(?:\{([^}\n]+)\}|([\p{L}\p{N}_](?:[\p{L}\p{N}_]|[.:#$%&+?<>~/-](?=[\p{L}\p{N}_]))*))/gu;
  for (const match of visible.matchAll(keyPattern)) {
    const from = match.index;
    const preceding = visible[from - 1] ?? "";
    if (escaped(visible, from) || /[\p{L}\p{N}_@/]/u.test(preceding)) continue;
    if (preceding === "-" && /[\p{L}\p{N}_]/u.test(visible[from - 2] ?? ""))
      continue;
    add("citation", match[1] ?? match[2], from, from + match[0].length);
  }
  return occurrences.sort((a, b) => a.from - b.from);
}
