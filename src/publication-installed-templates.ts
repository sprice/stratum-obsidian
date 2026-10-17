import {
  DEFAULT_ACADEMIC_OPTIONS,
  readAcademicDefaults,
} from "./publish-options";
import {
  installationId,
  type TemplateInstallation,
} from "./publication-installation";
import type { PublishingTemplate } from "./publish-templates";
import type { JournalProfile } from "./journal-profiles";

export function installedPublishingTemplate(
  installation: TemplateInstallation,
): PublishingTemplate {
  return {
    id: installationId(installation),
    name: installation.name,
    documentType: "academic",
    renderer: "journal",
    version: {
      familyId: `registry:${installation.pin.metadata.templateId}`,
      label: installation.pin.metadata.version,
    },
    layout: {
      ...DEFAULT_ACADEMIC_OPTIONS,
      titleSource: "body",
      showDate: false,
      bodyFont: "",
      titleFont: "",
    },
    properties: [],
    prefill: readAcademicDefaults(undefined),
  };
}
export function installedJournalProfile(
  installation: TemplateInstallation,
): JournalProfile {
  return {
    id: installationId(installation),
    family: "registry",
    name: installation.name,
    label: installation.pin.metadata.version,
    upstreamVersion: String(installation.pin.metadata.upstreamVersion),
    version: "1.0.0",
    compiler: "tectonic",
    outputs: ["pdf"],
    dependencies: [],
    provenance: String(installation.pin.metadata.upstreamUrl),
    class: installation.adapter.documentClass,
    classOptions: installation.adapter.classOptions,
    bibliography: installation.adapter.bibliography,
    citations: installation.adapter.citations,
    anonymous:
      installation.adapter.frontMatter === "acmart" &&
      installation.adapter.classOptions.includes("anonymous"),
    installation,
  };
}
