import { installedPublishingTemplate } from "../publication-installed-templates";
import { readTemplateInstallation } from "../publication-installation";
import installation from "./fixtures/installation.json";
/** Synthetic descriptor for isolated view/grouping tests; not a shipped profile. */
export const INSTALLED_TEMPLATE = {
  ...installedPublishingTemplate(readTemplateInstallation(installation)),
  id: "registry:example:1.0-r1",
  name: "Synthetic template",
  version: { familyId: "registry:example", label: "Synthetic current" },
};
