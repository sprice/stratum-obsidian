import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_AASTEX_PDF_OPTIONS,
  readAastexPdfOptions,
  readPublicationPackageReference,
} from "../publication-options";
import { readNotePreferences } from "../publish-options";
test("legacy AASTeX notes keep on/on/off defaults and never inherit new vault choices", () => {
  assert.deepEqual(
    readNotePreferences({ templateId: "package:aastex" }).aastex,
    { options: DEFAULT_AASTEX_PDF_OPTIONS },
  );
  assert.equal(
    readNotePreferences({ templateId: "general" }).aastex,
    undefined,
  );
  assert.deepEqual(
    readAastexPdfOptions({
      showLineNumbers: false,
      showDraftDateHeader: "false",
      numberedHeadings: true,
    }),
    {
      showLineNumbers: false,
      showDraftDateHeader: true,
      numberedHeadings: true,
    },
  );
});
test("saved options and package identity survive selection of another template", () => {
  const aastex = {
    options: {
      showLineNumbers: false,
      showDraftDateHeader: false,
      numberedHeadings: true,
    },
    package: { id: "aastex", version: "1.1.0", upstreamVersion: "7.0.2" },
  };
  assert.deepEqual(
    readNotePreferences({ templateId: "general", aastex }).aastex,
    aastex,
  );
  assert.equal(
    readPublicationPackageReference({
      id: "aastex",
      version: "../unsafe",
      upstreamVersion: "7",
    }),
    undefined,
  );
});
