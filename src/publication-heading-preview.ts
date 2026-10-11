import { unified } from "unified";
import remarkParse from "remark-parse";
import { aastexHeadingOutline } from "./publication-headings";
interface Heading {
  level: number;
  text: string;
}
interface MarkdownNode {
  type: string;
  depth?: number;
  value?: string;
  children?: MarkdownNode[];
}
function markdownText(node: MarkdownNode): string {
  return node.value ?? node.children?.map(markdownText).join("") ?? "";
}
/** Preview only; export validates the actual rendered Pandoc headings again. */
export function aastexHeadingIssues(markdown: string): string[] {
  const headings: Heading[] = [];
  const visit = (node: MarkdownNode) => {
    if (node.type === "heading" && node.depth)
      headings.push({ level: node.depth, text: markdownText(node) });
    node.children?.forEach(visit);
  };
  visit(unified().use(remarkParse).parse(markdown));
  if (!headings.some((heading) => heading.level === 1))
    for (const heading of headings) heading.level--;
  return aastexHeadingOutline(headings).issues;
}
