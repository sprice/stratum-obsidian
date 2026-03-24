export class ZoteroTokenInvalidError extends Error {
  constructor(message?: string) {
    super(message ?? "Zotero authorization failed. Please reconnect your Zotero account.");
    this.name = "ZoteroTokenInvalidError";
  }
}
