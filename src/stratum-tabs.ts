export const STRATUM_TABS = [
  { id: "browse", label: "Browse" },
  { id: "search", label: "Search" },
  { id: "sync", label: "Sync" },
  { id: "reader", label: "Reader" },
  { id: "sources", label: "Sources" },
] as const;

export type StratumTab = (typeof STRATUM_TABS)[number]["id"];
export type EnabledTabs = Record<StratumTab, boolean>;

export function readEnabledTabs(value: unknown): EnabledTabs {
  const stored =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  return Object.fromEntries(
    STRATUM_TABS.map(({ id }) => [id, stored[id] !== false]),
  ) as EnabledTabs;
}

export function getVisibleTabs(enabled: EnabledTabs, isDesktop: boolean) {
  return STRATUM_TABS.filter(
    ({ id }) => enabled[id] && (id !== "sync" || isDesktop),
  );
}

export function resolveActiveTab(
  active: StratumTab | null,
  enabled: EnabledTabs,
  isDesktop: boolean,
): StratumTab | null {
  const tabs = getVisibleTabs(enabled, isDesktop);
  return tabs.find(({ id }) => id === active)?.id ?? tabs[0]?.id ?? null;
}
