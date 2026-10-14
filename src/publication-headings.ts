export const AASTEX_HEADING_WARNING =
  "Heading numbers could not be normalized consistently. Exporting all headings unchanged; AASTeX will add its own numbering, so duplicates may remain.";
interface Heading {
  level: number;
  text: string;
  unnumbered?: boolean;
}
interface Inline {
  t: string;
  c?: unknown;
}
interface Header {
  t: "Header";
  c: [number, [string, string[], unknown], Inline[]];
}
export function aastexHeadingOutline(headings: Heading[]) {
  const counters = [0, 0, 0];
  const issues: string[] = [];
  const prefixes: number[] = [];
  let candidates = 0;
  for (const heading of headings) {
    const match = /^(\d+(?:\.\d+)*)(\.)?\s+/.exec(heading.text);
    const candidate = match && (match[2] || match[1].includes("."));
    prefixes.push(candidate ? match[0].length : 0);
    if (candidate) candidates++;
    if (heading.unnumbered) {
      prefixes[prefixes.length - 1] = 0;
      continue;
    }
    if (heading.level > 3) {
      if (candidate)
        issues.push(
          `“${heading.text}”: this heading level is not numbered by AASTeX.`,
        );
      continue;
    }
    const index = heading.level - 1;
    if (counters.slice(0, index).some((value) => value === 0))
      issues.push(`“${heading.text}”: a parent heading is missing.`);
    counters[index]++;
    counters.fill(0, index + 1);
    const expected = counters.slice(0, index + 1).join(".");
    if (candidate && !heading.text.slice(match[0].length).trim())
      issues.push(
        `“${heading.text}”: no title remains after the heading number.`,
      );
    if (candidate && match[1] !== expected)
      issues.push(`“${heading.text}”: expected heading number ${expected}.`);
  }
  return {
    issues: candidates ? issues : [],
    prefixes,
  };
}
function inlineChildren(inline: Inline): Inline[] | undefined {
  if (
    [
      "Emph",
      "Strong",
      "Underline",
      "Strikeout",
      "SmallCaps",
      "Superscript",
      "Subscript",
    ].includes(inline.t)
  )
    return inline.c as Inline[];
  if (["Span", "Link", "Quoted"].includes(inline.t))
    return (inline.c as unknown[])[1] as Inline[];
  return undefined;
}
function inlineText(inline: Inline): string {
  if (inline.t === "Str") return inline.c as string;
  if (["Space", "SoftBreak", "LineBreak"].includes(inline.t)) return " ";
  const children = inlineChildren(inline);
  if (inline.t === "Quoted" && children)
    return `“${children.map(inlineText).join("")}”`;
  if (children) return children.map(inlineText).join("");
  if (["Code", "Math"].includes(inline.t))
    return (inline.c as unknown[])[1] as string;
  return "";
}
function trimPrefix(inlines: Inline[], length: number) {
  let remaining = length;
  let unsupported = false;
  const trim = (items: Inline[]): Inline[] => {
    const result: Inline[] = [];
    for (const inline of items) {
      if (!remaining) {
        result.push(inline);
        continue;
      }
      if (inline.t === "Str") {
        const value = inline.c as string;
        const count = Math.min(remaining, value.length);
        remaining -= count;
        if (count < value.length)
          result.push({ ...inline, c: value.slice(count) });
      } else if (["Space", "SoftBreak", "LineBreak"].includes(inline.t)) {
        remaining--;
      } else {
        const children = inlineChildren(inline);
        if (!children) {
          unsupported = true;
          return items;
        }
        const next = trim(children);
        if (Array.isArray(inline.c) && inline.c === children)
          result.push({ ...inline, c: next });
        else {
          const value = [...(inline.c as unknown[])];
          value[1] = next;
          result.push({ ...inline, c: value });
        }
      }
    }
    return result;
  };
  const result = trim(inlines);
  return { inlines: result, remaining, unsupported };
}
/** Mutate only a private export AST, after the entire outline has validated. */
export function normalizeAastexPandocHeadings(document: unknown): string[] {
  const headers: Header[] = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === "object") {
      const node = value as { t?: string; c?: unknown };
      if (node.t === "Header") headers.push(node as Header);
      else Object.values(value).forEach(visit);
    }
  };
  visit(document);
  const analysis = aastexHeadingOutline(
    headers.map((header) => ({
      level: header.c[0],
      text: header.c[2].map(inlineText).join(""),
      unnumbered: header.c[1][1].includes("unnumbered"),
    })),
  );
  const replacements = headers.map((header, index) =>
    trimPrefix(header.c[2], analysis.prefixes[index]),
  );
  for (const [index, replacement] of replacements.entries())
    if (replacement.remaining || replacement.unsupported)
      analysis.issues.push(
        `“${headers[index].c[2].map(inlineText).join("")}”: the prefix uses unsupported inline content.`,
      );
  if (analysis.issues.length) return analysis.issues;
  headers.forEach((header, index) => {
    header.c[2] = replacements[index].inlines;
  });
  return [];
}
