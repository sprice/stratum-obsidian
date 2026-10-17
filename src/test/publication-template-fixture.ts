import { installedPublishingTemplate } from "../publication-installed-templates";
import { readTemplateInstallation } from "../publication-installation";
import installation from "./fixtures/installation.json";
/** Synthetic descriptor for isolated view/grouping tests; not a shipped profile. */
export const AASTEX_TEMPLATE = {
  ...installedPublishingTemplate(readTemplateInstallation(installation)),
  id: "package:aastex",
  name: "Synthetic template",
  version: { familyId: "package:aastex", label: "Synthetic current" },
};
