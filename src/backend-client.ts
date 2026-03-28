import {
  requestUrl,
  type RequestUrlParam,
  type RequestUrlResponse,
} from "obsidian";
import {
  PLUGIN_API_BASE_URL,
  PLUGIN_SUPABASE_PUBLISHABLE_KEY,
  PLUGIN_SUPABASE_URL,
} from "./build-config";
import {
  ZoteroNotConnectedError,
  ZoteroRateLimitedError,
  ZoteroTokenInvalidError,
} from "./zotero-errors";
import { log } from "./log";
import type {
  AuthenticatedUserResponse,
  AuthenticatedUserSummary,
  BackendErrorPayload,
  BackendAuthState,
  OpenAlexEnrichment,
  RefreshResponse,
  ZoteroLibraryCatalogPageResponse,
  ZoteroConnectionState,
  ZoteroItemDetail,
  ZoteroLibraryChangesResponse,
  ZoteroSearchResponse,
} from "./backend-types";
import type { PersistedAuthSession } from "./settings";

const REFRESH_BUFFER_SECONDS = 60;
const AUTH_ERROR_STATUSES = new Set([401, 403]);

type AuthedRequestOptions = Omit<RequestUrlParam, "throw" | "url"> & {
  skipSessionClearOnAuthError?: boolean;
};

export type {
  AuthenticatedUserResponse,
  AuthenticatedUserSummary,
  BackendErrorPayload,
  BackendAuthState,
  OpenAlexEnrichment,
  RefreshResponse,
  ZoteroLibraryCatalogItem,
  ZoteroLibraryCatalogPageResponse,
  ZoteroLibraryIdentity,
  ZoteroConnectionState,
  ZoteroItemDetail,
  ZoteroLibraryChangesResponse,
  ZoteroSearchMeta,
  ZoteroSearchResponse,
  ZoteroSearchResult,
} from "./backend-types";
export {
  ZoteroNotConnectedError,
  ZoteroRateLimitedError,
  ZoteroTokenInvalidError,
} from "./zotero-errors";

export class BackendClient {
  private state: BackendAuthState;
  private onSessionChange: (session: PersistedAuthSession | null) => Promise<void>;
  private onUserChange: (user: AuthenticatedUserSummary | null) => Promise<void>;

  constructor(options: {
    initialSession: PersistedAuthSession | null;
    onSessionChange: (session: PersistedAuthSession | null) => Promise<void>;
    onUserChange: (user: AuthenticatedUserSummary | null) => Promise<void>;
  }) {
    this.state = {
      session: options.initialSession,
    };
    this.onSessionChange = options.onSessionChange;
    this.onUserChange = options.onUserChange;
  }

  hasSession(): boolean {
    return Boolean(this.state.session?.accessToken);
  }

  getSession(): PersistedAuthSession | null {
    return this.state.session;
  }

  async setSession(params: {
    accessToken: string;
    refreshToken: string;
    expiresAt: number | null;
    email?: string | null;
  }): Promise<void> {
    this.state.session = {
      accessToken: params.accessToken,
      refreshToken: params.refreshToken,
      expiresAt: params.expiresAt,
    };

    await this.onSessionChange(this.state.session);
    await this.onUserChange({
      email: params.email ?? null,
    });
  }

  async clearSession(): Promise<void> {
    this.state.session = null;
    await this.onSessionChange(null);
    await this.onUserChange(null);
  }

  async validateSession(): Promise<AuthenticatedUserSummary | null> {
    const accessToken = await this.getValidAccessToken();
    if (!accessToken) {
      return null;
    }

    const response = await requestUrl({
      url: `${PLUGIN_SUPABASE_URL}/auth/v1/user`,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        apikey: PLUGIN_SUPABASE_PUBLISHABLE_KEY,
      },
      throw: false,
    });

    if (!this.isOk(response)) {
      if (AUTH_ERROR_STATUSES.has(response.status)) {
        await this.clearSession();
      }
      return null;
    }

    const payload = this.readJson<AuthenticatedUserResponse>(response);
    const user = {
      email: payload.email ?? null,
    };
    await this.onUserChange(user);
    return user;
  }

  async getZoteroConnectionStatus(): Promise<ZoteroConnectionState | null> {
    const response = await this.authedFetch("/zotero-connection-status");
    if (!this.isOk(response)) {
      return null;
    }

    return this.readJson<ZoteroConnectionState>(response);
  }

  async searchZoteroLibrary(
    query: string,
    options?: { refresh?: boolean }
  ): Promise<ZoteroSearchResponse> {
    const encodedQuery = encodeURIComponent(query.trim());
    const refreshSuffix = options?.refresh ? "&refresh=1" : "";
    const response = await this.authedFetch(
      `/zotero-library-search?q=${encodedQuery}${refreshSuffix}`
    );

    this.throwIfBackendError(response, "Zotero library search failed");

    return this.readJson<ZoteroSearchResponse>(response);
  }

  async getZoteroLibraryCatalogPage(params: {
    start: number;
    limit: number;
  }): Promise<ZoteroLibraryCatalogPageResponse> {
    const query = new URLSearchParams({
      start: String(params.start),
      limit: String(params.limit),
    });
    const response = await this.authedFetch(
      `/zotero-library-catalog-page?${query.toString()}`
    );

    this.throwIfBackendError(response, "Failed to load Zotero library catalog page");

    return this.readJson<ZoteroLibraryCatalogPageResponse>(response);
  }

  async getZoteroItemDetail(itemKey: string): Promise<ZoteroItemDetail> {
    const response = await this.authedFetch(
      `/zotero-item-detail?key=${encodeURIComponent(itemKey)}`
    );

    this.throwIfBackendError(response, "Failed to load Zotero item detail");

    return this.readJson<ZoteroItemDetail>(response);
  }

  async getOpenAlexEnrichment(
    doi: string
  ): Promise<OpenAlexEnrichment | null> {
    try {
      const response = await this.authedFetch(
        `/openalex-enrich?doi=${encodeURIComponent(doi)}`,
        { skipSessionClearOnAuthError: true }
      );
      if (!this.isOk(response)) {
        return null;
      }
      const payload = this.readJson<{
        enrichment: OpenAlexEnrichment | null;
      }>(response);
      return payload.enrichment;
    } catch {
      return null;
    }
  }

  async getZoteroLibraryChanges(
    sinceVersion: number | null
  ): Promise<ZoteroLibraryChangesResponse> {
    const query = sinceVersion === null ? "" : `?since=${encodeURIComponent(String(sinceVersion))}`;
    const response = await this.authedFetch(`/zotero-library-changes${query}`);

    this.throwIfBackendError(response, "Failed to load Zotero library changes");

    return this.readJson<ZoteroLibraryChangesResponse>(response);
  }

  async authedFetch(
    path: string,
    init?: AuthedRequestOptions
  ): Promise<RequestUrlResponse> {
    const accessToken = await this.getValidAccessToken();
    if (!accessToken) {
      throw new Error("No authenticated app session available.");
    }

    const { skipSessionClearOnAuthError, ...requestInit } = init ?? {};
    const method = requestInit.method ?? "GET";
    const start = performance.now();
    log("fetch", `${method} ${path}`);

    const response = await requestUrl({
      ...requestInit,
      url: `${PLUGIN_API_BASE_URL}${path}`,
      throw: false,
      headers: {
        ...(requestInit.headers ?? {}),
        Authorization: `Bearer ${accessToken}`,
        apikey: PLUGIN_SUPABASE_PUBLISHABLE_KEY,
      },
    });

    log("fetch", `${method} ${path} done`, {
      status: response.status,
      ms: Math.round(performance.now() - start),
    });

    if (AUTH_ERROR_STATUSES.has(response.status) && !skipSessionClearOnAuthError) {
      await this.clearSession();
    }

    return response;
  }

  private async getValidAccessToken(): Promise<string | null> {
    const session = this.state.session;
    if (!session) {
      return null;
    }

    const expiresAt = session.expiresAt;
    if (!expiresAt || expiresAt - REFRESH_BUFFER_SECONDS > Date.now() / 1000) {
      return session.accessToken;
    }

    log("auth", "access token expiring, refreshing session");
    const refreshed = await this.refreshSession(session.refreshToken);
    return refreshed?.accessToken ?? null;
  }

  private async refreshSession(
    refreshToken: string
  ): Promise<PersistedAuthSession | null> {
    const response = await requestUrl({
      url: `${PLUGIN_SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`,
      method: "POST",
      headers: {
        apikey: PLUGIN_SUPABASE_PUBLISHABLE_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        refresh_token: refreshToken,
      }),
      throw: false,
    });

    if (!this.isOk(response)) {
      log("auth", "session refresh failed", { status: response.status });
      await this.clearSession();
      return null;
    }

    log("auth", "session refreshed");
    const payload = this.readJson<RefreshResponse>(response);
    const nextSession: PersistedAuthSession = {
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token,
      expiresAt:
        payload.expires_at ??
        (payload.expires_in
          ? Math.floor(Date.now() / 1000) + payload.expires_in
          : null),
    };

    this.state.session = nextSession;
    await this.onSessionChange(nextSession);
    if (payload.user?.email) {
      await this.onUserChange({ email: payload.user.email });
    }

    return nextSession;
  }

  private isOk(response: RequestUrlResponse): boolean {
    return response.status >= 200 && response.status < 300;
  }

  private throwIfBackendError(
    response: RequestUrlResponse,
    fallbackMessage: string
  ): void {
    if (this.isOk(response)) {
      return;
    }

    const payload = this.tryReadJson<BackendErrorPayload>(response) ?? {};
    if (payload.zoteroTokenInvalid) {
      throw new ZoteroTokenInvalidError(payload.error);
    }

    if (
      typeof payload.error === "string" &&
      /zotero account is not connected/i.test(payload.error)
    ) {
      throw new ZoteroNotConnectedError(payload.error);
    }

    if (payload.rateLimited) {
      throw new ZoteroRateLimitedError(
        payload.retryAfterSeconds
          ? `${payload.error ?? fallbackMessage} Retry in about ${payload.retryAfterSeconds} seconds.`
          : payload.error ?? fallbackMessage,
        payload.retryAfterSeconds ?? 60
      );
    }

    throw new Error(payload.error ?? fallbackMessage);
  }

  private readJson<T>(response: RequestUrlResponse): T {
    return response.json as T;
  }

  private tryReadJson<T>(response: RequestUrlResponse): T | null {
    if (!response.text.trim()) {
      return null;
    }

    try {
      return JSON.parse(response.text) as T;
    } catch {
      return null;
    }
  }
}
