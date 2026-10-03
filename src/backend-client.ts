import {
  requestUrl,
  type RequestUrlParam,
  type RequestUrlResponse,
} from "obsidian";
import { hasAuthenticatedUserRequiredError } from "./backend-auth";
import { getNormalizedDoiLookupKey, normalizeDoi } from "./doi";
import {
  PLUGIN_API_BASE_URL,
  PLUGIN_SUPABASE_PUBLISHABLE_KEY,
  PLUGIN_SUPABASE_URL,
} from "./build-config";
import {
  ZoteroItemNotFoundError,
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
  OpenAlexEnrichmentBatchResult,
  OpenAlexEnrichmentBatchResponse,
  OpenAlexEnrichmentStatus,
  RefreshResponse,
  ZoteroLibraryCollectionsResponse,
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

export type LibraryParam = {
  type: "user" | "group";
  id: string;
};

export type {
  AuthenticatedUserResponse,
  AuthenticatedUserSummary,
  BackendErrorPayload,
  BackendAuthState,
  OpenAlexEnrichment,
  OpenAlexEnrichmentBatchResult,
  OpenAlexEnrichmentBatchResponse,
  OpenAlexEnrichmentStatus,
  RefreshResponse,
  ZoteroCollectionSummary,
  ZoteroLibraryCollectionsResponse,
  ZoteroLibraryCatalogItem,
  ZoteroLibraryCatalogPageResponse,
  ZoteroGroupSummary,
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
  private sessionChangeGeneration = 0;
  private pendingRefresh: {
    session: PersistedAuthSession;
    promise: Promise<PersistedAuthSession | null>;
  } | null = null;
  private onSessionChange: (
    session: PersistedAuthSession | null,
  ) => Promise<void>;
  private onUserChange: (
    user: AuthenticatedUserSummary | null,
  ) => Promise<void>;

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

  invalidatePendingRequests(): void {
    this.sessionChangeGeneration += 1;
    // Detach in-flight responses without logging out or deleting saved tokens.
    this.state.session = this.state.session ? { ...this.state.session } : null;
    this.pendingRefresh = null;
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
  }): Promise<boolean> {
    const generation = ++this.sessionChangeGeneration;
    // Verify the new account before replacing the session or reusing cached data.
    const response = await requestUrl({
      url: `${PLUGIN_SUPABASE_URL}/auth/v1/user`,
      headers: {
        Authorization: `Bearer ${params.accessToken}`,
        apikey: PLUGIN_SUPABASE_PUBLISHABLE_KEY,
      },
      throw: false,
    });
    if (generation !== this.sessionChangeGeneration) return false;
    if (!this.isOk(response)) {
      throw new Error("Could not verify the account. Try signing in again.");
    }
    const payload = this.readJson<AuthenticatedUserResponse>(response);
    if (
      !payload ||
      typeof payload.id !== "string" ||
      !payload.id.trim() ||
      (payload.email != null && typeof payload.email !== "string")
    ) {
      throw new Error("The app returned an invalid account response.");
    }
    const user = { id: payload.id, email: payload.email ?? null };
    this.state.session = {
      accessToken: params.accessToken,
      refreshToken: params.refreshToken,
      expiresAt: params.expiresAt,
    };

    const session = this.state.session;
    // Clear a previous account's state before persistence yields to other work.
    await this.onUserChange(user);
    if (
      generation !== this.sessionChangeGeneration ||
      this.state.session !== session
    )
      return false;
    await this.onSessionChange(session);
    return (
      generation === this.sessionChangeGeneration &&
      this.state.session === session
    );
  }

  async clearSession(): Promise<void> {
    this.sessionChangeGeneration += 1;
    this.state.session = null;
    await this.onSessionChange(null);
    if (this.state.session !== null) return;
    await this.onUserChange(null);
  }

  async validateSession(
    retried = false,
  ): Promise<AuthenticatedUserSummary | null> {
    const accessToken = await this.getValidAccessToken();
    if (!accessToken || this.state.session?.accessToken !== accessToken) {
      return null;
    }

    const session = this.state.session;
    const response = await requestUrl({
      url: `${PLUGIN_SUPABASE_URL}/auth/v1/user`,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        apikey: PLUGIN_SUPABASE_PUBLISHABLE_KEY,
      },
      throw: false,
    });

    if (this.state.session !== session) return null;
    if (!this.isOk(response)) {
      if (AUTH_ERROR_STATUSES.has(response.status) && !retried && session) {
        const refreshed = await this.sharedRefresh(session);
        if (refreshed) return this.validateSession(true);
      }
      return null;
    }

    const payload = this.readJson<AuthenticatedUserResponse>(response);
    const user = {
      email: payload.email ?? null,
      ...(payload.id ? { id: payload.id } : {}),
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
    options?: {
      refresh?: boolean;
      library?: LibraryParam;
      collectionKey?: string | null;
    },
  ): Promise<ZoteroSearchResponse> {
    const queryParams = new URLSearchParams({
      q: query.trim(),
    });
    if (options?.refresh) {
      queryParams.set("refresh", "1");
    }
    appendLibraryParams(queryParams, options?.library);
    appendCollectionParams(queryParams, options?.collectionKey);
    const response = await this.authedFetch(
      `/zotero-library-search?${queryParams.toString()}`,
    );

    this.throwIfBackendError(response, "Zotero library search failed");

    return this.readJson<ZoteroSearchResponse>(response);
  }

  async getZoteroLibraryCollections(options?: {
    library?: LibraryParam;
  }): Promise<ZoteroLibraryCollectionsResponse> {
    const query = new URLSearchParams();
    appendLibraryParams(query, options?.library);
    const suffix = query.toString();
    const response = await this.authedFetch(
      `/zotero-library-collections${suffix ? `?${suffix}` : ""}`,
    );

    this.throwIfBackendError(response, "Failed to load Zotero collections");

    return this.readJson<ZoteroLibraryCollectionsResponse>(response);
  }

  async getZoteroLibraryCatalogPage(params: {
    start: number;
    limit: number;
    library?: LibraryParam;
    collectionKey?: string | null;
  }): Promise<ZoteroLibraryCatalogPageResponse> {
    const query = new URLSearchParams({
      start: String(params.start),
      limit: String(params.limit),
    });
    appendLibraryParams(query, params.library);
    appendCollectionParams(query, params.collectionKey);
    const response = await this.authedFetch(
      `/zotero-library-catalog-page?${query.toString()}`,
    );

    this.throwIfBackendError(
      response,
      "Failed to load Zotero library catalog page",
    );

    return this.readJson<ZoteroLibraryCatalogPageResponse>(response);
  }

  async getZoteroItemDetail(
    itemKey: string,
    options?: { library?: LibraryParam },
  ): Promise<ZoteroItemDetail> {
    const query = new URLSearchParams({
      key: itemKey,
    });
    appendLibraryParams(query, options?.library);
    const response = await this.authedFetch(
      `/zotero-item-detail?${query.toString()}`,
    );

    if (
      response.status === 404 &&
      this.tryReadJson<BackendErrorPayload>(response)?.error ===
        "Zotero item not found."
    ) {
      throw new ZoteroItemNotFoundError();
    }
    this.throwIfBackendError(response, "Failed to load Zotero item detail");

    return this.readJson<ZoteroItemDetail>(response);
  }

  async getOpenAlexEnrichments(
    dois: string[],
    options?: { throwOnFailure?: boolean },
  ): Promise<Record<string, OpenAlexEnrichmentBatchResult>> {
    const normalizedDois = Array.from(
      new Set(
        dois
          .map((doi) => normalizeDoi(doi))
          .filter((doi): doi is string => Boolean(doi)),
      ),
    );
    const lookupMap: Record<string, OpenAlexEnrichmentBatchResult> =
      Object.fromEntries(
        normalizedDois.map((doi) => [
          getNormalizedDoiLookupKey(doi)!,
          {
            doi,
            enrichment: null,
            status: "temporary_failure" satisfies OpenAlexEnrichmentStatus,
          },
        ]),
      );

    if (normalizedDois.length === 0) {
      return lookupMap;
    }

    try {
      const response = await this.authedFetch("/enrich", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          dois: normalizedDois,
        }),
      });
      if (!this.isOk(response)) {
        if (options?.throwOnFailure) {
          this.throwIfBackendError(response, "Failed to load enrichment");
        }
        return lookupMap;
      }

      const payload = this.readJson<OpenAlexEnrichmentBatchResponse>(response);
      for (const result of payload.results) {
        const lookupKey = getNormalizedDoiLookupKey(result.doi);
        if (!lookupKey) {
          continue;
        }

        lookupMap[lookupKey] = result;
      }

      return lookupMap;
    } catch (error) {
      if (options?.throwOnFailure) {
        throw error;
      }

      return lookupMap;
    }
  }

  async getOpenAlexEnrichment(
    doi: string,
    options?: { throwOnFailure?: boolean },
  ): Promise<OpenAlexEnrichment | null | undefined> {
    const lookupKey = getNormalizedDoiLookupKey(doi);
    if (!lookupKey) {
      return null;
    }

    const results = await this.getOpenAlexEnrichments([doi], options);
    const result = results[lookupKey];
    if (!result) {
      return null;
    }

    if (result.status === "temporary_failure") {
      return undefined;
    }

    return result.enrichment;
  }

  async getZoteroLibraryChanges(
    sinceVersion: number | null,
    options?: { library?: LibraryParam },
  ): Promise<ZoteroLibraryChangesResponse> {
    const query = new URLSearchParams();
    if (sinceVersion !== null) {
      query.set("since", String(sinceVersion));
    }
    appendLibraryParams(query, options?.library);
    const suffix = query.toString();
    const response = await this.authedFetch(
      `/zotero-library-changes${suffix ? `?${suffix}` : ""}`,
    );

    this.throwIfBackendError(response, "Failed to load Zotero library changes");

    return this.readJson<ZoteroLibraryChangesResponse>(response);
  }

  async authedFetch(
    path: string,
    init?: AuthedRequestOptions,
    retried = false,
  ): Promise<RequestUrlResponse> {
    const accessToken = await this.getValidAccessToken();
    if (!accessToken || this.state.session?.accessToken !== accessToken) {
      throw new Error("No authenticated app session available.");
    }

    const session = this.state.session;
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

    if (this.state.session !== session) {
      throw new Error(
        "The app session changed while the request was in progress. Try again.",
      );
    }
    const payload = this.tryReadJson<BackendErrorPayload>(response);
    if (
      hasAuthenticatedUserRequiredError(payload) ||
      (AUTH_ERROR_STATUSES.has(response.status) && !skipSessionClearOnAuthError)
    ) {
      if (!retried) {
        const refreshed = await this.sharedRefresh(session);
        if (refreshed && this.state.session === refreshed)
          return this.authedFetch(path, init, true);
      }
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
    const refreshed = await this.sharedRefresh(session);
    return refreshed && this.state.session === refreshed
      ? refreshed.accessToken
      : null;
  }

  private sharedRefresh(
    session: PersistedAuthSession,
  ): Promise<PersistedAuthSession | null> {
    if (this.pendingRefresh?.session !== session) {
      const promise = this.refreshSession(session);
      const pending = { session, promise };
      this.pendingRefresh = pending;
      void promise
        .finally(() => {
          if (this.pendingRefresh === pending) this.pendingRefresh = null;
        })
        .catch(() => {});
    }
    return this.pendingRefresh.promise;
  }

  private async refreshSession(
    session: PersistedAuthSession,
  ): Promise<PersistedAuthSession | null> {
    const response = await requestUrl({
      url: `${PLUGIN_SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`,
      method: "POST",
      headers: {
        apikey: PLUGIN_SUPABASE_PUBLISHABLE_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        refresh_token: session.refreshToken,
      }),
      throw: false,
    });

    if (this.state.session !== session) return null;
    if (!this.isOk(response)) {
      log("auth", "session refresh failed", { status: response.status });
      if (response.status === 400 || AUTH_ERROR_STATUSES.has(response.status)) {
        await this.clearSession();
        return null;
      }
      throw new Error(
        "The app session could not be refreshed. Try again shortly.",
      );
    }

    log("auth", "session refreshed");
    const payload = this.readJson<RefreshResponse>(response);
    if (
      !payload ||
      typeof payload.access_token !== "string" ||
      !payload.access_token ||
      typeof payload.refresh_token !== "string" ||
      !payload.refresh_token
    ) {
      throw new Error("The app returned an invalid session refresh response.");
    }
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
    if (this.state.session !== nextSession) return null;
    if (payload.user?.email) {
      await this.onUserChange({
        email: payload.user.email,
        ...(payload.user.id ? { id: payload.user.id } : {}),
      });
    }

    return nextSession;
  }

  private isOk(response: RequestUrlResponse): boolean {
    return response.status >= 200 && response.status < 300;
  }

  private throwIfBackendError(
    response: RequestUrlResponse,
    fallbackMessage: string,
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
          : (payload.error ?? fallbackMessage),
        payload.retryAfterSeconds ?? 60,
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

function appendLibraryParams(
  query: URLSearchParams,
  library?: LibraryParam,
): void {
  if (!library) {
    return;
  }

  query.set("libraryType", library.type);
  query.set("libraryId", library.id);
}

function appendCollectionParams(
  query: URLSearchParams,
  collectionKey?: string | null,
): void {
  if (!collectionKey) {
    return;
  }

  query.set("collectionKey", collectionKey);
}
