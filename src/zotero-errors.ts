export class ZoteroTokenInvalidError extends Error {
  constructor(message?: string) {
    super(
      message ??
        "Zotero authorization failed. Please reconnect your Zotero account.",
    );
    this.name = "ZoteroTokenInvalidError";
  }
}

export class ZoteroNotConnectedError extends Error {
  constructor(message?: string) {
    super(message ?? "Zotero account is not connected.");
    this.name = "ZoteroNotConnectedError";
  }
}

export class ZoteroRateLimitedError extends Error {
  retryAfterSeconds: number;

  constructor(message?: string, retryAfterSeconds = 60) {
    super(
      message ??
        `Zotero asked Stratum to slow down. Retry in about ${retryAfterSeconds} seconds.`,
    );
    this.name = "ZoteroRateLimitedError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}
