import { unified } from "unified";
import remarkParse from "remark-parse";

const markdown = unified().use(remarkParse);

/** Only top-level thematic breaks count; properties, code, and quotes do not. */
function horizontalRules(
  text: string,
  document = true,
): { from: number; to: number }[] {
  const properties =
    document &&
    /^(?:\uFEFF)?---\r?\n(?:[\s\S]*?\r?\n)?(?:---|\.\.\.)(?:\r?\n|$)/.exec(
      text,
    );
  const prose = properties
    ? properties[0].replace(/[^\r\n]/g, " ") + text.slice(properties[0].length)
    : text;
  return markdown.parse(prose).children.flatMap((node) => {
    const from = node.position?.start.offset;
    const to = node.position?.end.offset;
    return node.type === "thematicBreak" &&
      from !== undefined &&
      to !== undefined
      ? [{ from, to }]
      : [];
  });
}

export function summaryInsertion(
  text: string,
  offset: number,
  summary: string,
) {
  const before = text.slice(0, offset);
  const after = text.slice(offset);
  // Remove surrounding blank lines, not Markdown-significant indentation.
  let content = summary
    .replace(/\r\n/g, "\n")
    .replace(/^(?:[ \t]*\n)+|(?:\n[ \t]*)+$/g, "");
  const existingRules = horizontalRules(text);
  const templateRules = horizontalRules(content, false);
  const first = templateRules.find(
    (rule) => !content.slice(0, rule.from).trim(),
  );
  const last = templateRules.find((rule) => !content.slice(rule.to).trim());
  const sharedTop = existingRules.some(
    (rule) =>
      rule.to <= offset &&
      /^[ \t]*(?:\r?\n[ \t]*)?$/.test(text.slice(rule.to, offset)),
  );
  const sharedBottom = existingRules.some(
    (rule) =>
      rule.from >= offset &&
      /^[ \t]*(?:\r?\n[ \t]*)?$/.test(text.slice(offset, rule.from)),
  );
  // Remove only rules belonging to this insertion; never rewrite existing text.
  if (sharedBottom && last)
    content = content.slice(0, last.from).replace(/(?:\n[ \t]*)+$/, "");
  if (!sharedBottom && !last) content += "\n\n---";
  if (sharedTop && first)
    content = content.slice(first.to).replace(/^(?:[ \t]*\n)+/, "");
  if (!sharedTop && !first)
    content = (/^#{1,6} /.test(content) ? "---\n" : "---\n\n") + content;
  // A Markdown divider at the beginning of a file would open YAML properties.
  const prefix =
    sharedTop && /^#{1,6} /.test(content)
      ? /\n[ \t]*$/.test(before)
        ? ""
        : "\n"
      : !before && /^---(?:\n|$)/.test(content)
        ? "\n"
        : !before || before.endsWith("\n\n")
          ? ""
          : before.endsWith("\n")
            ? "\n"
            : "\n\n";
  const suffix = after.startsWith("\n\n")
    ? ""
    : after.startsWith("\n")
      ? "\n"
      : "\n\n";
  const insert = prefix + content + suffix;
  const promptLabel = content.includes("**Main argument:**")
    ? "**Main argument:**"
    : "**Why it matters:**";
  const prompt = content.indexOf(promptLabel);
  const endingRule = horizontalRules(content, false).find(
    (rule) => !content.slice(rule.to).trim(),
  );
  const writingEnd = endingRule
    ? content.slice(0, endingRule.from).replace(/(?:\n[ \t]*)+$/, "").length
    : content.length;
  return {
    insert,
    cursor:
      offset +
      prefix.length +
      (prompt < 0 ? writingEnd : prompt + promptLabel.length),
  };
}
