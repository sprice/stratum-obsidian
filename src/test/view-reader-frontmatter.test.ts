import test from "node:test";
import assert from "node:assert/strict";
import {
  buildReaderFrontmatterMarkdown,
  parseReaderFrontmatter,
  stripLeadingFrontmatter,
} from "../view-reader-frontmatter";

function parseYamlForTest(yaml: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  let currentListKey: string | null = null;

  for (const rawLine of yaml.split("\n")) {
    const line = rawLine.replace(/\r$/, "");
    if (!line.trim()) {
      continue;
    }

    if (line.startsWith("  - ")) {
      if (!currentListKey) {
        throw new Error("invalid yaml");
      }

      const list = result[currentListKey];
      if (!Array.isArray(list)) {
        throw new Error("invalid yaml");
      }

      list.push(line.slice(4).replace(/^"|"$/g, ""));
      continue;
    }

    currentListKey = null;
    const separatorIndex = line.indexOf(":");
    if (separatorIndex === -1) {
      throw new Error("invalid yaml");
    }

    const key = line.slice(0, separatorIndex).trim();
    const rawValue = line.slice(separatorIndex + 1).trim();
    if (!rawValue) {
      result[key] = [];
      currentListKey = key;
      continue;
    }

    if (rawValue.startsWith("[") && !rawValue.endsWith("]")) {
      throw new Error("invalid yaml");
    }

    result[key] = rawValue.replace(/^"|"$/g, "");
  }

  return result;
}

test("reader frontmatter markdown hides internal bookkeeping and formats useful metadata", () => {
  const markdown = buildReaderFrontmatterMarkdown({
    aliases: ["Vaswani et al 2017", "Attention Is All You Need"],
    tags: ["literature-note", "source/zotero", "reference/preprint"],
    authors: ["[[Ashish Vaswani]]", "[[Noam Shazeer]]", "[[Niki Parmar]]"],
    year: "2017",
    reference_type: "Preprint",
    doi: "https://doi.org/10.48550/arXiv.1706.03762",
    source: "https://arxiv.org/abs/1706.03762v7",
    cited_by_count: 6512,
    fwci: 130.8,
    citation_percentile: 0.99973088,
    is_open_access: "yes",
    oa_status: "gold",
    openalex_id: "https://openalex.org/W2626778328",
    openalex_topics: [
      "[[Natural Language Processing Techniques]]",
      "[[Topic Modeling]]",
    ],
    zotero_link: "zotero://select/groups/4242424/items/ITEM0002",
    zotero_group_name: "example-group",
    stratum_note_type: "literature-note",
    zotero_item_key: "ITEM0002",
    zotero_attachment_keys: ["2M2FL6IM"],
  });

  assert.match(markdown, /^> \[!info]\+ Metadata$/m);
  assert.match(
    markdown,
    /\*\*Aliases\*\*: Vaswani et al 2017, Attention Is All You Need/,
  );
  assert.match(
    markdown,
    /\*\*Tags\*\*: #literature-note, #source\/zotero, #reference\/preprint/,
  );
  assert.match(
    markdown,
    /\*\*DOI\*\*: \[10\.48550\/arXiv\.1706\.03762]\(https:\/\/doi\.org\/10\.48550\/arXiv\.1706\.03762\)/,
  );
  assert.match(
    markdown,
    /\*\*Source\*\*: \[Source]\(https:\/\/arxiv\.org\/abs\/1706\.03762v7\)/,
  );
  assert.match(markdown, /\*\*Cited by\*\*: 6,512/);
  assert.match(markdown, /\*\*FWCI\*\*: 130\.8/);
  assert.match(markdown, /\*\*Citation percentile\*\*: 99\.97%/);
  assert.match(markdown, /\*\*Open access\*\*: Yes/);
  assert.match(markdown, /\*\*OA status\*\*: Gold/);
  assert.match(
    markdown,
    /\*\*OpenAlex\*\*: \[W2626778328]\(https:\/\/openalex\.org\/W2626778328\)/,
  );
  assert.match(
    markdown,
    /\*\*OpenAlex topics\*\*: \[\[Natural Language Processing Techniques\]\], \[\[Topic Modeling\]\]/,
  );
  assert.match(
    markdown,
    /\*\*Zotero\*\*: \[Open in Zotero]\(zotero:\/\/select\/groups\/4242424\/items\/ITEM0002\)/,
  );
  assert.match(markdown, /\*\*Zotero group\*\*: example-group/);
  assert.doesNotMatch(markdown, /stratum_note_type/);
  assert.doesNotMatch(markdown, /zotero_item_key/);
  assert.doesNotMatch(markdown, /zotero_attachment_keys/);
});

test("reader frontmatter markdown handles empty input and internal-only input", () => {
  assert.equal(buildReaderFrontmatterMarkdown(), "");
  assert.equal(buildReaderFrontmatterMarkdown(null), "");
  assert.equal(buildReaderFrontmatterMarkdown({}), "");
  assert.equal(
    buildReaderFrontmatterMarkdown({
      stratum_note_type: "literature-note",
      zotero_item_key: "ITEM0001",
    }),
    "",
  );
});

test("reader frontmatter markdown formats edge-case values", () => {
  const markdown = buildReaderFrontmatterMarkdown({
    citation_key: "vaswani2017attention",
    date_added: "2026-03-31T17:36:22.933Z",
    oa_url: "https://example.com/download.pdf",
    is_retracted: "no",
    custom_flag: true,
    custom_payload: { score: 5, source: "manual" },
    mixed_values: ["alpha", 2, false, { beta: 3 }, null],
    doi: "10.1002/(SICI)1097-4571(199205)43:4<284::AID-ASI3>3.0.CO;2-0",
  });

  assert.match(markdown, /\*\*Citation key\*\*: `vaswani2017attention`/);
  assert.match(markdown, /\*\*Date added\*\*: 2026-03-31/);
  assert.match(
    markdown,
    /\*\*Open access PDF\*\*: \[Open access PDF]\(https:\/\/example\.com\/download\.pdf\)/,
  );
  assert.match(markdown, /\*\*Retracted\*\*: No/);
  assert.match(markdown, /\*\*Custom Flag\*\*: Yes/);
  assert.match(
    markdown,
    /\*\*Custom Payload\*\*: `\{"score":5,"source":"manual"\}`/,
  );
  assert.match(markdown, /\*\*Mixed Values\*\*: alpha, 2, No, `\{"beta":3\}`/);
  assert.match(
    markdown,
    /\*\*DOI\*\*: \[10\.1002\/\(SICI\)1097-4571\(199205\)43:4<284::AID-ASI3>3\.0\.CO;2-0]\(https:\/\/doi\.org\/10\.1002\/%28SICI%291097-4571%28199205%2943:4<284::AID-ASI3>3\.0\.CO;2-0\)/,
  );
});

test("reader frontmatter parsing survives invalid yaml while still stripping it from the body", () => {
  const invalidContent = [
    "---",
    "aliases: [broken",
    "zotero_item_key: ABCD1234",
    "---",
    "",
    "# Body",
    "Reader content",
  ].join("\n");

  assert.deepEqual(
    parseReaderFrontmatter(invalidContent, parseYamlForTest),
    {},
  );
  assert.equal(
    stripLeadingFrontmatter(invalidContent),
    "# Body\nReader content",
  );
});

test("reader frontmatter parsing returns parsed fields for valid yaml", () => {
  const content = [
    "---",
    "aliases:",
    "  - Attention Is All You Need",
    "zotero_group_name: example-group",
    'year: "2017"',
    "---",
    "",
    "# Body",
  ].join("\n");

  assert.deepEqual(parseReaderFrontmatter(content, parseYamlForTest), {
    aliases: ["Attention Is All You Need"],
    zotero_group_name: "example-group",
    year: "2017",
  });
  assert.equal(stripLeadingFrontmatter(content), "# Body");
});

test("reader frontmatter parsing and stripping handle CRLF and no-frontmatter content", () => {
  const content = [
    "---",
    "aliases:",
    '  - "Attention Is All You Need"',
    "is_open_access: yes",
    "---",
    "",
    "# Body",
    "Reader content",
  ].join("\r\n");

  assert.deepEqual(parseReaderFrontmatter(content, parseYamlForTest), {
    aliases: ["Attention Is All You Need"],
    is_open_access: "yes",
  });
  assert.equal(stripLeadingFrontmatter(content), "# Body\r\nReader content");
  assert.equal(
    stripLeadingFrontmatter("# Body only\nNo frontmatter here"),
    "# Body only\nNo frontmatter here",
  );
});
