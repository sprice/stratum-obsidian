import test from "node:test";
import assert from "node:assert/strict";
import {
  buildLiteratureNoteWikiLink,
  extractPreferredLinkText,
} from "../literature-note-links";

test("extractPreferredLinkText prefers the managed short alias", () => {
  const preferredLinkText = extractPreferredLinkText(
    {
      aliases: [
        "Woo 2026",
        "Born in the Dark",
        "Born in the Dark: The Catastrophic Collapse of Fuzzy Dark Matter Solitons as the Origin of Little Red Dots",
      ],
      stratum_managed_aliases: [
        "Woo 2026",
        "Born in the Dark",
        "Born in the Dark: The Catastrophic Collapse of Fuzzy Dark Matter Solitons as the Origin of Little Red Dots",
      ],
    },
    "Woo 2026 - Born in the Dark",
  );

  assert.equal(preferredLinkText, "Woo 2026");
});

test("extractPreferredLinkText falls back to the leading alias when managed aliases are missing", () => {
  const preferredLinkText = extractPreferredLinkText(
    {
      aliases: ["Woo 2026", "Born in the Dark"],
    },
    "Woo 2026 - Born in the Dark",
  );

  assert.equal(preferredLinkText, "Woo 2026");
});

test("extractPreferredLinkText returns null when there is no short alias", () => {
  const preferredLinkText = extractPreferredLinkText(
    {
      aliases: ["Woo 2026 - Born in the Dark", "Born in the Dark"],
      stratum_managed_aliases: ["@wooBornDarkCatastrophic2026"],
    },
    "Woo 2026 - Born in the Dark",
  );

  assert.equal(preferredLinkText, null);
});

test("buildLiteratureNoteWikiLink inserts basename and short display text", () => {
  const wikilink = buildLiteratureNoteWikiLink({
    basename: "Woo 2026 - Born in the Dark",
    preferredLinkText: "Woo 2026",
  });

  assert.equal(wikilink, "[[Woo 2026 - Born in the Dark|Woo 2026]]");
});

test("buildLiteratureNoteWikiLink falls back to the basename when no short text exists", () => {
  const wikilink = buildLiteratureNoteWikiLink({
    basename: "Woo 2026 - Born in the Dark",
    preferredLinkText: null,
  });

  assert.equal(wikilink, "[[Woo 2026 - Born in the Dark]]");
});

test("buildLiteratureNoteWikiLink escapes wiki-link delimiters", () => {
  const wikilink = buildLiteratureNoteWikiLink({
    basename: "Paper | Title]",
    preferredLinkText: "Woo | 2026]",
  });

  assert.equal(wikilink, "[[Paper \\| Title\\]|Woo \\| 2026\\]]]");
});
