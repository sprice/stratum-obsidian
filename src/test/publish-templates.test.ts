import assert from "node:assert/strict";
import test from "node:test";
import {
  readPublishingTemplates,
  removePublishingTemplate,
  selectedPublishingTemplate,
} from "../publish-templates";
import {
  addPublishingProperties,
  publishingPropertyProblem,
  mappedPublishingProperties,
  readPublishingProperties,
} from "../publish-properties";

test("built-ins remain configurable and protected without defaults or implicit selection", () => {
  const state = readPublishingTemplates(undefined);
  assert.deepEqual(
    state.templates.map((t) => t.name),
    ["General documents", "Academic papers"],
  );
  assert.equal(state.templates[0].properties.length, 0);
  assert.equal(state.templates[1].properties[0].required, true);
  assert.equal(selectedPublishingTemplate(state), undefined);
  assert.equal(removePublishingTemplate(state, "academic"), state);
  const custom = { ...state.templates[0], id: "custom", name: "Custom" };
  const loaded = readPublishingTemplates({
    templates: [...state.templates, custom],
  });
  assert.equal(selectedPublishingTemplate(loaded, "custom")!.name, "Custom");
  assert.equal(
    selectedPublishingTemplate(
      removePublishingTemplate(loaded, "custom"),
      "custom",
    ),
    undefined,
  );
});
test("property preparation preserves values and only explicit mappings reach the document", () => {
  const fields = readPublishingProperties([
    { key: "paper_title", type: "text", required: true, use: "title" },
    {
      key: "team",
      type: "list",
      defaultValue: "Synthetic author\nAnother author",
      use: "authors",
    },
    {
      key: "private_status",
      type: "text",
      defaultValue: "draft",
      use: "metadata",
    },
  ]);
  const properties = { paper_title: "Existing title" } as Record<
    string,
    unknown
  >;
  assert.match(publishingPropertyProblem({}, fields), /paper_title/);
  addPublishingProperties(properties, "Note name", fields);
  assert.equal(properties.paper_title, "Existing title");
  assert.equal(publishingPropertyProblem(properties, fields), "");
  assert.deepEqual(mappedPublishingProperties(properties, fields), {
    title: "Existing title",
    authors: ["Synthetic author", "Another author"],
  });
  assert.equal(properties.private_status, "draft");
  const empty = {};
  addPublishingProperties(empty, "Note name", fields);
  assert.equal(mappedPublishingProperties(empty, fields).title, "Note name");
});
test("properties validate types and dates and reject duplicate or unsafe definitions", () => {
  const fields = readPublishingProperties([
    { key: "date", type: "date", required: true, use: "date" },
    { key: "__proto__" },
    { key: "date" },
  ]);
  assert.equal(fields.length, 1);
  assert.match(
    publishingPropertyProblem({ date: "2026-02-30" }, fields),
    /valid date/,
  );
  assert.equal(publishingPropertyProblem({ date: "2026-02-28" }, fields), "");
  assert.equal(publishingPropertyProblem({}, []), "");
  const optional = fields.map((field) => ({ ...field, required: false }));
  assert.equal(publishingPropertyProblem({ date: "not a date" }, optional), "");
  assert.deepEqual(
    mappedPublishingProperties({ date: "not a date" }, optional),
    {},
  );
});

test("bounded opening choices derive requirements and preserve prefill without a schema editor", () => {
  const initial = readPublishingTemplates(undefined);
  const academic = initial.templates[1];
  const configured = readPublishingTemplates({
    templates: [
      initial.templates[0],
      {
        ...academic,
        layout: {
          ...academic.layout,
          titleSource: "body",
          showAffiliations: false,
          showDate: false,
          showKeywords: false,
        },
        prefill: { ...academic.prefill, authors: ["Synthetic author"] },
        properties: [{ key: "custom_required", required: true, use: "title" }],
      },
    ],
  }).templates[1];
  assert.deepEqual(
    configured.properties.map((field) => field.key),
    ["authors"],
  );
  assert.equal(configured.properties[0].required, false);
  const properties = { authors: ["Existing author"] };
  addPublishingProperties(properties, "Synthetic note", configured.properties);
  assert.deepEqual(properties.authors, ["Existing author"]);
  const empty = {};
  addPublishingProperties(empty, "Synthetic note", configured.properties);
  assert.deepEqual(mappedPublishingProperties(empty, configured.properties), {
    authors: ["Synthetic author"],
  });
  const loaded = readPublishingTemplates(
    JSON.parse(
      JSON.stringify({ templates: [initial.templates[0], configured] }),
    ),
  );
  assert.deepEqual(loaded.templates[1].prefill.authors, ["Synthetic author"]);
  assert.equal(loaded.templates[1].layout.titleSource, "body");
});
