export function shouldUseLocalOpenedNoteRefresh(params: {
  isDesktopApp: boolean;
  bulkSyncEnabled: boolean;
}): boolean {
  return params.isDesktopApp && params.bulkSyncEnabled;
}

export function shouldMarkLiteratureNoteDeletedAfterRefreshMiss(params: {
  usedLocal: boolean;
  localMissing: boolean;
  backendMissing: boolean;
}): boolean {
  return params.backendMissing && (!params.usedLocal || params.localMissing);
}
