import { publicationManuscript } from "./publication-manuscript";
import {
  changePublicationProperty,
  publicationYaml,
  publicationAuthors,
  type PublicationChange,
} from "./publication-metadata";
import {
  addPublishingProperties,
  type PublishingProperty,
} from "./publish-properties";
import {
  packageProperties,
  packageProblems,
  type PackageVariant,
} from "./publication-package";

/** The package owns the schema; the host supplies only document context. */
export function preparePackageProperties(
  text: string,
  filename: string,
  variant: PackageVariant,
) {
  const original = publicationYaml(text);
  const properties = { ...original.properties };
  const fields = packageProperties(variant);
  const heading = publicationManuscript(text, "body");
  const context: Record<string, string> = {
    heading: heading.title,
    filename,
    title:
      typeof properties.title === "string"
        ? properties.title
        : heading.title || filename,
    abstract: heading.abstract,
  };
  const definitions: PublishingProperty[] = [];
  for (const f of fields.filter((f) => f.required)) {
    if (
      f.type === "authors" &&
      (Object.hasOwn(properties, "authors") ||
        Object.hasOwn(properties, "author") ||
        publicationAuthors(properties).structured)
    )
      continue;
    definitions.push({
      key: f.key,
      type: f.type === "authors" ? "list" : f.type,
      required: true,
      use: "metadata",
      defaultValue:
        f.prefill.map((rule) => context[rule]).find((value) => value?.trim()) ||
        f.default,
    });
  }
  // Reuse the existing missing-only preparation policy.
  addPublishingProperties(properties, filename, definitions);
  const added = Object.keys(properties).filter(
    (key) => !Object.hasOwn(original.properties, key),
  );
  let updated = text;
  const allowed = fields.map((f) => f.key);
  for (const key of added) {
    const change = changePublicationProperty(
      updated,
      { key, value: properties[key] as string | string[] },
      allowed,
    );
    updated =
      updated.slice(0, change.from) + change.insert + updated.slice(change.to);
  }
  const end = publicationYaml(updated).end;
  const start = original.end === 0 && text.startsWith("\uFEFF") ? 1 : 0;
  const change: PublicationChange = {
    from: start,
    to: Math.max(start, original.end),
    insert: updated.slice(start, end),
  };
  return {
    change,
    added,
    remaining: packageProblems(
      variant,
      publicationManuscript(updated, "properties", { packageProperties: true }),
    ),
  };
}
