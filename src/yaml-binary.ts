import type { ScalarTag } from "yaml";

// Frontmatter binary values stay encoded text. Publication edits preserve their
// source bytes; no feature needs to turn these values into executable payloads
// or byte arrays. Replaces YAML's binary codec in browser bundles.
export const binary: ScalarTag = {
  tag: "tag:yaml.org,2002:binary",
  default: false,
  resolve: (value) => value,
};
