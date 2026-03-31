import test from "node:test";
import assert from "node:assert/strict";
import type { ZoteroItemDetail } from "../backend-client";
import {
  getGeneratedCitekeyStem,
  getReadableFileStem,
  getReadableTitleVariants,
  resolveExistingFilenameStemState,
} from "../literature-note-filenames";

function createDetail(overrides?: Partial<ZoteroItemDetail>): ZoteroItemDetail {
  return {
    zoteroUserId: "19946899",
    library: {
      type: "user",
      id: "19946899",
      zoteroUriSegment: "library",
      identity: "user:19946899",
    },
    item: {
      key: "YC2RW7WT",
      version: 34,
      title:
        "Predicting Personality Test Scores with Machine Learning Methodology: Investigation of a New Approach to Psychological Assessment",
      creators: ["Andreas Glöckner", "Moritz Michels", "Daniel Giersch"],
      year: "2020",
      date: "2020-04-17",
      itemType: "preprint",
      abstract: null,
      doi: "10.31234/osf.io/ysd3f",
      url: "https://osf.io/preprints/psyarxiv/ysd3f",
      publicationTitle: null,
      collections: [],
      tags: [],
      zoteroSelectUri: "zotero://select/library/items/YC2RW7WT",
      isbn: null,
      issn: null,
      volume: null,
      issue: null,
      pages: null,
      publisher: null,
      place: null,
      language: null,
      shortTitle: null,
      citationKey: null,
      edition: null,
      numPages: null,
      series: null,
      seriesTitle: null,
      seriesNumber: null,
      journalAbbreviation: null,
      conferenceName: null,
      university: null,
      bookTitle: null,
      reportNumber: null,
      reportType: null,
      thesisType: null,
      pmid: null,
      pmcid: null,
      arxivId: null,
      dateAdded: null,
      dateModified: null,
      citation: null,
    },
    attachments: [],
    zoteroNotes: [],
    annotations: [],
    ...overrides,
  };
}

test("getReadableTitleVariants strips subtitles and truncates at word boundaries", () => {
  const variants = getReadableTitleVariants(
    "Predicting Personality Test Scores with Machine Learning Methodology: Investigation of a New Approach to Psychological Assessment",
  );

  assert.equal(
    variants.mainTitle,
    "Predicting Personality Test Scores with Machine Learning Methodology",
  );
  assert.equal(
    variants.fileTitle,
    "Predicting Personality Test Scores with Machine Learning Methodology",
  );
  assert.equal(
    variants.fullTitle,
    "Predicting Personality Test Scores with Machine Learning Methodology: Investigation of a New Approach to Psychological Assessment",
  );
});

test("getReadableFileStem preserves Unicode and formats author labels", () => {
  assert.equal(
    getReadableFileStem(createDetail()),
    "Glöckner et al 2020 - Predicting Personality Test Scores with Machine Learning Methodology",
  );

  assert.equal(
    getReadableFileStem(
      createDetail({
        item: {
          ...createDetail().item,
          creators: ["Andreas Glöckner", "Moritz Michels"],
        },
      }),
    ),
    "Glöckner & Michels 2020 - Predicting Personality Test Scores with Machine Learning Methodology",
  );
});

test("getGeneratedCitekeyStem uses a generated fallback citekey", () => {
  assert.equal(
    getGeneratedCitekeyStem(createDetail()),
    "@glockner2020predicting",
  );
});

test("resolveExistingFilenameStemState respects manual renames and legacy notes", () => {
  assert.deepEqual(
    resolveExistingFilenameStemState({
      currentStem: "Glöckner et al 2020 - Predicting Personality Test Scores",
      storedStem: "Glöckner et al 2020 - Predicting Personality Test Scores",
      desiredStem: "@glockner2020predicting",
      previousVersion: 34,
      currentVersion: 34,
    }),
    {
      shouldRename: true,
      nextStoredStem: "@glockner2020predicting",
    },
  );

  assert.deepEqual(
    resolveExistingFilenameStemState({
      currentStem: "My custom paper name",
      storedStem: "Glöckner et al 2020 - Predicting Personality Test Scores",
      desiredStem: "@glockner2020predicting",
      previousVersion: 34,
      currentVersion: 35,
    }),
    {
      shouldRename: false,
      nextStoredStem:
        "Glöckner et al 2020 - Predicting Personality Test Scores",
    },
  );

  assert.deepEqual(
    resolveExistingFilenameStemState({
      currentStem:
        "glockner-2020-predicting-personality-test-scores-with-machine-learning-methodology-investigati--user-19946899-YC2RW7WT",
      storedStem: null,
      desiredStem: "Glöckner et al 2020 - Predicting Personality Test Scores",
      previousVersion: 34,
      currentVersion: 34,
    }),
    {
      shouldRename: false,
      nextStoredStem:
        "glockner-2020-predicting-personality-test-scores-with-machine-learning-methodology-investigati--user-19946899-YC2RW7WT",
    },
  );

  assert.deepEqual(
    resolveExistingFilenameStemState({
      currentStem:
        "glockner-2020-predicting-personality-test-scores-with-machine-learning-methodology-investigati--user-19946899-YC2RW7WT",
      storedStem: null,
      desiredStem: "Glöckner et al 2020 - Predicting Personality Test Scores",
      previousVersion: 34,
      currentVersion: 35,
    }),
    {
      shouldRename: true,
      nextStoredStem:
        "Glöckner et al 2020 - Predicting Personality Test Scores",
    },
  );
});
