import {
  installationId,
  readTemplateInstallation,
  type TemplateInstallation,
} from "./publication-installation";
import { registryJson } from "./publication-registry";
import type { PublishingTemplates } from "./publish-templates";

/** Called only after every resource is verified. Reinstalling never changes an exact identity. */
export function enableVerifiedInstallation(
  state: PublishingTemplates,
  manifest: TemplateInstallation,
): PublishingTemplates {
  const id = installationId(manifest);
  const old = state.installations?.find((m) => installationId(m) === id);
  if (
    old &&
    new TextDecoder().decode(registryJson(old)) !==
      new TextDecoder().decode(registryJson(manifest))
  )
    throw new Error(
      "This release changed on the mirror. Its existing installation and document selections have been preserved.",
    );
  return {
    ...state,
    installations: old
      ? state.installations
      : [...(state.installations ?? []), manifest],
    enabledIds: [...new Set([...(state.enabledIds ?? []), id])],
  };
}
export function removeInstallation(
  state: PublishingTemplates,
  id: string,
): PublishingTemplates {
  return {
    ...state,
    installations: state.installations?.filter((m) => installationId(m) !== id),
    // Valid duplicate records are retained here by readPublishingTemplates.
    // Remove them too, or the next read would restore the removed version.
    unavailableInstallations: state.unavailableInstallations?.filter(
      (value) => {
        try {
          return installationId(readTemplateInstallation(value)) !== id;
        } catch {
          // Unsupported records remain opaque so a newer plugin can recover them.
          return true;
        }
      },
    ),
    enabledIds: state.enabledIds?.filter((value) => value !== id),
  };
}
