import { publicationAuthors, publicationYaml } from "./publication-metadata";

/** The body Abstract is consumed exactly once; fenced examples are not sections. */
export function publicationManuscript(
  text: string,
  titleSource: "body" | "properties",
) {
  const { properties, end } = publicationYaml(text);
  let body = text.slice(end);
  let title =
    typeof properties.title === "string" ? properties.title.trim() : "";
  if (titleSource === "body") {
    const match = /^\s*#\s+(.+?)(?:\s+#+)?\s*(?:\r?\n|$)/.exec(body);
    title = match?.[1].trim() ?? "";
    if (match) body = body.slice(match[0].length);
  }
  const sections: { from: number; start: number; to: number; level: number }[] =
    [];
  let offset = 0,
    fence = "";
  for (const line of body.match(/[^\n]*\n|[^\n]+$/g) ?? []) {
    const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker) {
      if (!fence) fence = marker;
      else if (
        marker[0] === fence[0] &&
        marker.length >= fence.length &&
        /^\s{0,3}(?:`{3,}|~{3,})\s*$/.test(line)
      )
        fence = "";
    } else if (!fence) {
      const heading = /^\s{0,3}(#{1,6})\s+(.+?)(?:\s+#+)?\s*$/.exec(
        line.trimEnd(),
      );
      if (heading) {
        for (const section of sections)
          if (section.to === body.length && heading[1].length <= section.level)
            section.to = offset;
        if (
          heading[1].length <= 2 &&
          heading[2].trim().toLowerCase() === "abstract"
        )
          sections.push({
            from: offset,
            start: offset + line.length,
            to: body.length,
            level: heading[1].length,
          });
      }
    }
    offset += line.length;
  }
  if (sections.length > 1)
    throw new Error(
      "This manuscript has multiple Abstract sections. Keep one before publishing.",
    );
  const section = sections[0];
  const abstract = section ? body.slice(section.start, section.to).trim() : "";
  if (section) body = body.slice(0, section.from) + body.slice(section.to);
  return {
    properties,
    title,
    body,
    abstract,
    authors: publicationAuthors(properties).authors,
  };
}
export function escapeLatex(text: string): string {
  const escapes: Record<string, string> = {
    "\\": "\\textbackslash{}",
    "{": "\\{",
    "}": "\\}",
    "#": "\\#",
    $: "\\$",
    "%": "\\%",
    "&": "\\&",
    _: "\\_",
    "~": "\\textasciitilde{}",
    "^": "\\textasciicircum{}",
  };
  return text.replace(/[\\{}#$%&_~^]/g, (character) => escapes[character]);
}
