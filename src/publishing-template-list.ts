import type {
  PublishingTemplate,
  PublishingTemplates,
} from "./publish-templates";
import { installedPublishingTemplate } from "./publication-installed-templates";
import {
  installedPackageChoices,
  type PackageInstallation,
} from "./publication-package-installation";
import type { TemplateInstallation } from "./publication-installation";

export interface InstalledTemplateRow {
  id: string;
  template: PublishingTemplate;
  version?: string;
  installation?: TemplateInstallation;
  packageInstallation?: PackageInstallation;
}

/** Presentation only: persisted IDs and document selections remain untouched. */
export function installedTemplateGroups(state: PublishingTemplates) {
  const rows: InstalledTemplateRow[] = [
    ...state.templates.map((template) => ({ id: template.id, template })),
    ...(state.installations ?? []).map((installation) => {
      const template = installedPublishingTemplate(installation);
      return {
        id: template.id,
        template,
        installation,
        version: installation.pin.metadata.upstreamVersion,
      };
    }),
    ...(state.packageInstallations ?? []).map((packageInstallation) => ({
      id: `download:${packageInstallation.manifest.id}:${packageInstallation.manifest.version}`,
      template: installedPackageChoices(packageInstallation)[0],
      packageInstallation,
      version: packageInstallation.manifest.version,
    })),
  ];
  const groups = new Map<
    string,
    { name: string; rows: InstalledTemplateRow[] }
  >();
  for (const row of rows) {
    const family =
      row.packageInstallation?.manifest.id ??
      row.installation?.pin.metadata.templateId;
    const key = family ? `registry:${family}` : row.id;
    let group = groups.get(key);
    if (!group) {
      group = { name: row.template.name, rows: [] };
      groups.set(key, group);
    }
    if (row.packageInstallation) group.name = row.template.name;
    group.rows.push(row);
  }
  return [...groups.values()];
}
