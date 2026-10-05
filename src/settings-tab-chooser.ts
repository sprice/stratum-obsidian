import { openChecklist, type ChecklistOptions } from "./settings-checklist";
import type { EnabledTabs, StratumTab } from "./stratum-tabs";

interface TabChooserOptions {
  tabs: readonly { id: StratumTab; label: string }[];
  enabled: EnabledTabs;
  keyboard?: ChecklistOptions["keyboard"];
  onChange: (id: StratumTab, enabled: boolean) => Promise<void>;
}

export function openTabChooser(
  anchor: HTMLButtonElement,
  options: TabChooserOptions,
): () => void {
  return openChecklist(anchor, {
    title: "Choose visible tabs",
    keyboard: options.keyboard,
    items: options.tabs.map((tab) => ({
      id: tab.id,
      label: tab.label,
      checked: options.enabled[tab.id],
    })),
    onChange: (id, enabled) => options.onChange(id as StratumTab, enabled),
  });
}
