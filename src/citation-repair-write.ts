import type { App, Editor } from "obsidian";
import { applyBibliographyRepair } from "./bibtex";
import type { planCitationRepair } from "./citation-repair-plan";

/** Reference data is prepared first; the paper changes in one undoable transaction. */
export async function commitCitationRepair(
  app: App,
  editor: Editor,
  bibliography: string,
  plan: ReturnType<typeof planCitationRepair>,
  valid: () => boolean,
): Promise<void> {
  await applyBibliographyRepair(app, bibliography, plan.bibliography, valid);
  if (!valid())
    throw new Error(
      "The paper changed while saving references. No manuscript edits were applied.",
    );
  editor.transaction({
    changes: plan.edits.map((edit) => ({
      from: editor.offsetToPos(edit.from),
      to: editor.offsetToPos(edit.to),
      text: edit.after,
    })),
  });
}
