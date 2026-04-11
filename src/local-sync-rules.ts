export function shouldShowSyncTab(params: {
  isDesktopApp: boolean;
  hasSession: boolean;
}): boolean {
  return params.isDesktopApp && params.hasSession;
}

export function shouldRefreshLocalSyncAfterCloudConnection(params: {
  isDesktopApp: boolean;
  hasSession: boolean;
  zoteroConnected: boolean;
  bulkSyncEnabled: boolean;
  bulkSyncPreferenceInitialized: boolean;
}): boolean {
  return (
    params.isDesktopApp &&
    params.hasSession &&
    params.zoteroConnected &&
    (params.bulkSyncEnabled || !params.bulkSyncPreferenceInitialized)
  );
}

export function resolveBulkSyncDefaultAfterLocalReady(params: {
  isDesktopApp: boolean;
  hasSession: boolean;
  zoteroConnected: boolean;
  bulkSyncEnabled: boolean;
  bulkSyncPreferenceInitialized: boolean;
}): {
  bulkSyncEnabled: boolean;
  bulkSyncPreferenceInitialized: boolean;
  changed: boolean;
} {
  if (
    !params.isDesktopApp ||
    !params.hasSession ||
    !params.zoteroConnected ||
    params.bulkSyncPreferenceInitialized
  ) {
    return {
      bulkSyncEnabled: params.bulkSyncEnabled,
      bulkSyncPreferenceInitialized: params.bulkSyncPreferenceInitialized,
      changed: false,
    };
  }

  return {
    bulkSyncEnabled: true,
    bulkSyncPreferenceInitialized: true,
    changed: !params.bulkSyncEnabled || !params.bulkSyncPreferenceInitialized,
  };
}
