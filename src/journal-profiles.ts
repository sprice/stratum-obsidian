import {
  installationId,
  type TemplateInstallation,
} from "./publication-installation";
import { installationLatex } from "./publication-installation-render";
import { installedJournalProfile } from "./publication-installed-templates";
import { aastexManuscript } from "./publication-package";
import type { PublishingIssue, PublishingProperty } from "./publish-properties";

export type JournalFamily = "registry";
export interface JournalProfile {
  id: string;
  family: JournalFamily;
  name: string;
  label: string;
  upstreamVersion: string;
  version: string;
  compiler: "tectonic";
  outputs: ["pdf"];
  dependencies: string[];
  provenance: string;
  class: string;
  classOptions: string[];
  bibliography: string;
  citations: "numeric" | "author-year";
  anonymous?: boolean;
  installation?: TemplateInstallation;
}
export function journalProfile(
  id?: string,
  installations: TemplateInstallation[] = [],
) {
  const installation = installations.find(
    (value) => installationId(value) === id,
  );
  return installation ? installedJournalProfile(installation) : undefined;
}
export function journalReference(p: JournalProfile) {
  if (!p.installation)
    throw new Error("Install this template from the registry.");
  return {
    id: p.id.replaceAll(":", "-"),
    version: `${p.version}-${p.installation.pin.metadata.version}`,
    upstreamVersion: p.upstreamVersion,
  };
}
export function journalProperties(
  profile: JournalProfile,
): PublishingProperty[] {
  const keys = ["stratum_corresponding_author"];
  const frontMatter = profile.installation?.adapter.frontMatter;
  if (
    ["acmart", "cas"].includes(frontMatter ?? "") ||
    ["mnras", "llncs"].includes(profile.class)
  )
    keys.push("stratum_running_title", "stratum_running_authors");
  if (profile.installation?.adapter.frontMatter === "acmart")
    keys.push("stratum_acm_conference", "stratum_acm_year", "stratum_acm_doi");
  return keys.map((key) => ({
    key,
    type: "text",
    required: false,
    defaultValue: "",
    use: "metadata",
  }));
}
export function journalProblems(
  text: string,
  titleSource: "body" | "properties",
  profile: JournalProfile,
  includeKeywords = true,
) {
  const manuscript = aastexManuscript(text, titleSource);
  if (!includeKeywords)
    manuscript.properties = { ...manuscript.properties, keywords: undefined };
  const issues: PublishingIssue[] = [];
  const problem = (message: string, target: "title" | "general" = "general") =>
    issues.push({ target, message, blocking: true });
  if (!manuscript.title)
    problem("Add a manuscript title using the selected title source.", "title");
  if (!profile.anonymous && !manuscript.authors.length)
    issues.push({
      target: "author",
      author: 0,
      field: "name",
      message: "Add at least one author.",
      blocking: true,
    });
  for (const [author, value] of manuscript.authors.entries()) {
    if (profile.anonymous) break;
    for (const field of ["name", "affiliations"] as const)
      if (
        field === "name"
          ? !value.name.trim()
          : !value.affiliations.some((a) => a.trim())
      )
        issues.push({
          target: "author",
          author,
          field,
          message: `Author ${author + 1} needs ${field === "name" ? "a name" : "an affiliation"}.`,
          blocking: true,
        });
    if (
      profile.installation?.adapter.frontMatter === "acmart" &&
      (!value.institution?.trim() ||
        !value.city?.trim() ||
        !value.country?.trim())
    )
      issues.push({
        target: "author",
        author,
        field: "affiliations",
        message: `Author ${author + 1}: enter institution, city and country for ACM.`,
        blocking: true,
      });
  }
  if (!manuscript.abstract)
    problem("Add one Abstract section before publishing this manuscript.");
  for (const field of journalProperties(profile))
    if (
      manuscript.properties[field.key] !== undefined &&
      typeof manuscript.properties[field.key] !== "string"
    )
      problem(`${field.key} must be text.`);
  const keywords = manuscript.properties.keywords;
  if (
    keywords !== undefined &&
    !(
      typeof keywords === "string" ||
      (Array.isArray(keywords) &&
        keywords.every((value) => typeof value === "string"))
    )
  )
    problem("Keywords must be text or a list of text values.");
  const year = manuscript.properties.stratum_acm_year;
  if (
    profile.installation?.adapter.frontMatter === "acmart" &&
    typeof year === "string" &&
    year.trim() &&
    !/^\d{4}$/.test(year)
  )
    problem("The publication year must be a four-digit year.");
  const corresponding = manuscript.properties.stratum_corresponding_author;
  if (
    !profile.anonymous &&
    typeof corresponding === "string" &&
    corresponding.trim() &&
    !manuscript.authors.some((a) => a.email.trim() === corresponding.trim())
  )
    problem("The corresponding author must match an author's email address.");
  return { manuscript, issues };
}
export function journalLatex(
  profile: JournalProfile,
  manuscript: ReturnType<typeof aastexManuscript>,
  body: string,
  abstract: string,
  bibliography: boolean,
  preamble = "",
): string {
  if (!profile.installation)
    throw new Error("Install this template from the registry.");
  return installationLatex(
    profile.installation,
    manuscript,
    body,
    abstract,
    bibliography,
    preamble,
  );
}
