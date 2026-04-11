import type { RequestUrlParam, RequestUrlResponse } from "obsidian";
import type {
  ZoteroCollectionSummary,
  ZoteroItemDetail,
  ZoteroLibraryCatalogPageResponse,
} from "./backend-types";
import {
  buildGroupLibrary,
  buildLibraryIdentity,
  buildPersonalLibrary,
  sortEnabledLibraries,
} from "./plugin-libraries";
import type { EnabledLibrary } from "./settings";
import { normalizeZoteroItemDetail } from "./zotero-item-detail-normalizer";

const LOCAL_ZOTERO_API_VERSION = 3;

type LocalRequestResponse = Pick<
  RequestUrlResponse,
  "status" | "headers" | "text"
> & {
  json: unknown;
};

type LocalRequest = (
  params: Pick<RequestUrlParam, "url" | "method" | "headers" | "body">,
) => Promise<LocalRequestResponse>;

type ZoteroCreator = {
  firstName?: string;
  lastName?: string;
  name?: string;
};

type ZoteroTag = {
  tag?: string;
};

type LocalLink = {
  href?: string;
  type?: string;
  title?: string;
  length?: number;
  attachmentType?: string;
  attachmentSize?: number;
};

type LocalApiItem = {
  key: string;
  version: number;
  bib?: string;
  library?: {
    type?: string;
    id?: number | string;
    name?: string;
  };
  links?: {
    self?: LocalLink;
    alternate?: LocalLink;
    enclosure?: LocalLink;
    attachment?: LocalLink;
    up?: LocalLink;
  };
  data: {
    itemType?: string;
    parentItem?: string;
    title?: string;
    creators?: ZoteroCreator[];
    date?: string;
    abstractNote?: string;
    DOI?: string;
    url?: string;
    name?: string;
    publicationTitle?: string;
    collections?: string[];
    tags?: ZoteroTag[];
    note?: string;
    contentType?: string;
    linkMode?: string;
    filename?: string;
    dateAdded?: string;
    dateModified?: string;
    citationKey?: string;
    ISBN?: string;
    ISSN?: string;
    volume?: string;
    issue?: string;
    pages?: string;
    publisher?: string;
    place?: string;
    language?: string;
    shortTitle?: string;
    extra?: string;
    edition?: string;
    numPages?: string;
    series?: string;
    seriesTitle?: string;
    seriesNumber?: string;
    journalAbbreviation?: string;
    conferenceName?: string;
    university?: string;
    bookTitle?: string;
    reportNumber?: string;
    reportType?: string;
    thesisType?: string;
    archiveID?: string;
    annotationType?: string;
    annotationColor?: string;
    annotationPageLabel?: string;
    annotationText?: string;
    annotationComment?: string;
  };
};

type LocalApiGroup = {
  id?: number | string;
  data?: {
    id?: number | string;
    name?: string;
    type?: string;
  };
  meta?: {
    numItems?: number | string;
  };
};

type LocalApiCollection = {
  key?: string;
  data?: {
    key?: string;
    name?: string;
    parentCollection?: string | false;
  };
};

type LocalCatalogItem = Pick<LocalApiItem, "key" | "version" | "data">;

type NodeResponseLike = {
  statusCode?: number;
  headers: Record<string, string | string[] | undefined>;
  on(event: "data", listener: (chunk: unknown) => void): void;
  on(event: "end", listener: () => void): void;
  on(event: "error", listener: (error: unknown) => void): void;
};

type NodeRequestLike = {
  on(event: "error", listener: (error: unknown) => void): void;
  write(chunk: string | Uint8Array): void;
  end(): void;
  destroy(): void;
};

type NodeHttpRequest = (
  options: {
    protocol: string;
    hostname: string;
    port: string;
    path: string;
    method: string;
    headers?: Record<string, string>;
  },
  callback: (response: NodeResponseLike) => void,
) => NodeRequestLike;

type NodeRequestModule = {
  request: NodeHttpRequest;
};

export class LocalZoteroApiError extends Error {
  status: number | null;

  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = "LocalZoteroApiError";
    this.status = status;
  }
}

export class LocalZoteroUnavailableError extends LocalZoteroApiError {
  constructor(message = "Local Zotero API is not available.") {
    super(message, null);
    this.name = "LocalZoteroUnavailableError";
  }
}

export class LocalZoteroHttpServerUnavailableError extends LocalZoteroUnavailableError {
  constructor(message = "The Zotero HTTP server is not running.") {
    super(message);
    this.name = "LocalZoteroHttpServerUnavailableError";
  }
}

export class LocalZoteroApiDisabledError extends LocalZoteroApiError {
  constructor(message = "The local Zotero API is disabled.", status = 403) {
    super(message, status);
    this.name = "LocalZoteroApiDisabledError";
  }
}

export class LocalZoteroApiVersionMismatchError extends LocalZoteroApiError {
  actualVersion: number | null;

  constructor(actualVersion: number | null) {
    super(
      actualVersion === null
        ? `Local Zotero API did not report a supported version. Stratum expects Zotero API v${LOCAL_ZOTERO_API_VERSION}.`
        : `Local Zotero API v${actualVersion} is not supported. Stratum expects Zotero API v${LOCAL_ZOTERO_API_VERSION}.`,
      null,
    );
    this.name = "LocalZoteroApiVersionMismatchError";
    this.actualVersion = actualVersion;
  }
}

function defaultLocalRequest(
  params: Pick<RequestUrlParam, "url" | "method" | "headers" | "body">,
) {
  return requestLocalViaNodeHttp(params).catch(() =>
    fallbackRequestUrl(params),
  );
}

async function fallbackRequestUrl(
  params: Pick<RequestUrlParam, "url" | "method" | "headers" | "body">,
): Promise<LocalRequestResponse> {
  const { requestUrl } = await import("obsidian");
  return requestUrl({
    ...params,
    throw: false,
  });
}

async function requestLocalViaNodeHttp(
  params: Pick<RequestUrlParam, "url" | "method" | "headers" | "body">,
): Promise<LocalRequestResponse> {
  const url = new URL(params.url);
  const nodeRequire = getNodeRequire();
  if (!nodeRequire) {
    throw new Error("Node HTTP client is not available.");
  }

  const requestModuleName =
    url.protocol === "https:" ? "node:https" : "node:http";
  const requestModule = nodeRequire(requestModuleName);
  if (!hasNodeRequestModule(requestModule)) {
    throw new Error("Node HTTP client is not available.");
  }

  return await new Promise<LocalRequestResponse>((resolve, reject) => {
    const req = requestModule.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port,
        path: `${url.pathname}${url.search}`,
        method: params.method ?? "GET",
        headers: params.headers,
      },
      (response) => {
        const chunks: Uint8Array[] = [];
        response.on("data", (chunk: unknown) => {
          const normalizedChunk = normalizeNodeChunk(chunk);
          if (!normalizedChunk) {
            reject(
              new Error("Unsupported response chunk from local Zotero API."),
            );
            req.destroy();
            return;
          }

          chunks.push(normalizedChunk);
        });
        response.on("end", () => {
          const text = decodeNodeChunks(chunks);
          let json: unknown = null;
          try {
            json = text ? JSON.parse(text) : null;
          } catch {
            json = null;
          }

          const headers: Record<string, string> = {};
          for (const [key, value] of Object.entries(response.headers)) {
            if (Array.isArray(value)) {
              headers[key] = value.join(", ");
            } else if (typeof value === "string") {
              headers[key] = value;
            }
          }

          resolve({
            status: response.statusCode ?? 0,
            headers,
            json,
            text,
          });
        });
        response.on("error", reject);
      },
    );

    req.on("error", reject);
    const requestBody = normalizeNodeRequestBody(params.body);
    if (requestBody !== null) {
      req.write(requestBody);
    }
    req.end();
  });
}

function normalizeNodeChunk(chunk: unknown): Uint8Array | null {
  if (typeof chunk === "string") {
    return new TextEncoder().encode(chunk);
  }

  if (chunk instanceof Uint8Array) {
    return chunk;
  }

  if (chunk instanceof ArrayBuffer) {
    return new Uint8Array(chunk);
  }

  if (ArrayBuffer.isView(chunk)) {
    return new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
  }

  return null;
}

function normalizeNodeRequestBody(
  body: RequestUrlParam["body"] | undefined,
): string | Uint8Array | null {
  if (typeof body === "string") {
    return body;
  }

  if (body instanceof ArrayBuffer) {
    return new Uint8Array(body);
  }

  return null;
}

function decodeNodeChunks(chunks: Uint8Array[]): string {
  const totalLength = chunks.reduce(
    (length, chunk) => length + chunk.byteLength,
    0,
  );
  const combined = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new TextDecoder().decode(combined);
}

function getNodeRequire(): ((moduleName: string) => unknown) | null {
  const maybeRequire = (
    window as Window & {
      require?: (moduleName: string) => unknown;
    }
  ).require;
  return typeof maybeRequire === "function" ? maybeRequire : null;
}

function buildApiUrl(port: number, path: string): string {
  return `http://127.0.0.1:${port}/api${path}`;
}

function buildConnectorUrl(port: number, path: string): string {
  return `http://127.0.0.1:${port}/connector${path}`;
}

function getHeader(
  headers: Record<string, string>,
  name: string,
): string | null {
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === target) {
      return value;
    }
  }

  return null;
}

function parseInteger(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }

  return Math.floor(parsed);
}

function buildLibraryBasePath(library: Pick<EnabledLibrary, "type" | "id">) {
  return `/${library.type === "user" ? "users" : "groups"}/${encodeURIComponent(library.id)}`;
}

async function requestPagedLocalArray<T>(params: {
  port: number;
  path: string;
  limit?: number;
  request?: LocalRequest;
}): Promise<T[]> {
  const limit = params.limit ?? 100;
  const items: T[] = [];
  let start = 0;

  while (true) {
    const separator = params.path.includes("?") ? "&" : "?";
    const response = await requestLocalJson<T[]>({
      port: params.port,
      path: `${params.path}${separator}limit=${limit}&start=${start}`,
      request: params.request,
    });
    items.push(...response.data);

    if (response.data.length < limit) {
      return items;
    }

    start += response.data.length;
  }
}

async function requestLocalText(params: {
  port: number;
  url: string;
  request?: LocalRequest;
  method?: "GET" | "POST";
  body?: string;
  headers?: Record<string, string>;
  unavailableMessage?: string;
}): Promise<{
  status: number;
  headers: Record<string, string>;
  text: string;
  json: unknown;
}> {
  try {
    const response = await (params.request ?? defaultLocalRequest)({
      url: params.url,
      method: params.method,
      body: params.body,
      headers: params.headers,
    });

    return {
      status: response.status,
      headers: response.headers,
      text: response.text,
      json: response.json,
    };
  } catch (error) {
    const message =
      params.unavailableMessage ??
      (error instanceof Error
        ? error.message
        : "Could not reach the local Zotero API.");
    throw new LocalZoteroUnavailableError(message);
  }
}

async function requestLocalJson<T>(params: {
  port: number;
  path: string;
  request?: LocalRequest;
  method?: "GET" | "POST";
  body?: string;
  headers?: Record<string, string>;
}): Promise<{
  status: number;
  headers: Record<string, string>;
  data: T;
}> {
  try {
    const response = await (params.request ?? defaultLocalRequest)({
      url: buildApiUrl(params.port, params.path),
      method: params.method,
      body: params.body,
      headers: params.headers,
    });

    if (response.status < 200 || response.status >= 300) {
      throw new LocalZoteroApiError(
        response.text ||
          `Local Zotero API request failed with ${response.status}.`,
        response.status,
      );
    }

    return {
      status: response.status,
      headers: response.headers,
      data: response.json as T,
    };
  } catch (error) {
    if (error instanceof LocalZoteroApiError) {
      throw error;
    }

    throw new LocalZoteroUnavailableError(
      error instanceof Error
        ? error.message
        : "Could not reach the local Zotero API.",
    );
  }
}

function parseUserIdFromLinkHeader(linkHeader: string | null): string | null {
  if (!linkHeader) {
    return null;
  }

  return (
    linkHeader.match(/https:\/\/www\.zotero\.org\/users\/(\d+)/i)?.[1] ??
    linkHeader.match(/\/api\/users\/(\d+)/i)?.[1] ??
    null
  );
}

function mapGroupLibrary(group: LocalApiGroup): EnabledLibrary | null {
  const idValue = group.data?.id ?? group.id;
  const id =
    typeof idValue === "number" || typeof idValue === "string"
      ? String(idValue).trim()
      : "";
  if (!id) {
    return null;
  }

  return buildGroupLibrary({
    id,
    name: group.data?.name?.trim() || `Group ${id}`,
  });
}

function isSyncableTopLevelItem(item: LocalCatalogItem): boolean {
  const itemType = item.data.itemType ?? "";
  return (
    itemType !== "attachment" &&
    itemType !== "note" &&
    itemType !== "annotation"
  );
}

async function fetchCollectionNameMap(params: {
  port: number;
  library: EnabledLibrary;
  keys: string[];
  request?: LocalRequest;
}): Promise<Array<{ key: string; name: string }>> {
  const uniqueKeys = Array.from(new Set(params.keys));
  if (uniqueKeys.length === 0) {
    return [];
  }

  const basePath = buildLibraryBasePath(params.library);
  const collectionMap = new Map<string, string>();

  await Promise.all(
    uniqueKeys.map(async (collectionKey) => {
      try {
        const response = await requestLocalJson<LocalApiCollection>({
          port: params.port,
          path: `${basePath}/collections/${encodeURIComponent(collectionKey)}?format=json`,
          request: params.request,
        });
        const key = response.data.data?.key?.trim() || collectionKey;
        const name = response.data.data?.name?.trim() || collectionKey;
        collectionMap.set(key, name);
      } catch {
        collectionMap.set(collectionKey, collectionKey);
      }
    }),
  );

  return params.keys.map((collectionKey) => ({
    key: collectionKey,
    name: collectionMap.get(collectionKey) ?? collectionKey,
  }));
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function hasNodeRequestModule(value: unknown): value is NodeRequestModule {
  return isObjectRecord(value) && typeof value.request === "function";
}

async function fetchLocalAnnotationsForAttachments(params: {
  port: number;
  library: EnabledLibrary;
  attachments: LocalApiItem[];
  request?: LocalRequest;
}): Promise<LocalApiItem[]> {
  if (params.attachments.length === 0) {
    return [];
  }

  const attachmentsByKey = new Map(
    params.attachments.map(
      (attachment) => [attachment.key, attachment] as const,
    ),
  );

  const basePath = buildLibraryBasePath(params.library);
  const annotationItems = await requestPagedLocalArray<LocalApiItem>({
    port: params.port,
    path: `${basePath}/items?format=json&itemType=annotation`,
    request: params.request,
  });

  return annotationItems.filter((item) => {
    if (item.data.itemType !== "annotation") {
      return false;
    }

    const parentItem = item.data.parentItem?.trim() || "";
    return attachmentsByKey.has(parentItem);
  });
}

export async function ensureLocalZoteroReady(params: {
  port: number;
  request?: LocalRequest;
}): Promise<{ apiVersion: number }> {
  const pingUrl = buildConnectorUrl(params.port, "/ping");
  const apiRootUrl = buildApiUrl(params.port, "/");

  let pingResponse;
  try {
    pingResponse = await requestLocalText({
      port: params.port,
      url: pingUrl,
      request: params.request,
      unavailableMessage: `Could not reach the Zotero HTTP server on port ${params.port}. Open Zotero on this desktop, then try again.`,
    });
  } catch (error) {
    if (error instanceof LocalZoteroUnavailableError) {
      throw new LocalZoteroHttpServerUnavailableError(error.message);
    }
    throw error;
  }

  if (pingResponse.status < 200 || pingResponse.status >= 300) {
    throw new LocalZoteroHttpServerUnavailableError(
      `Could not reach the Zotero HTTP server on port ${params.port}. Open Zotero on this desktop, then try again.`,
    );
  }

  const apiResponse = await requestLocalText({
    port: params.port,
    url: apiRootUrl,
    request: params.request,
    unavailableMessage:
      "Zotero is running, but the local API did not respond as expected.",
  });

  if (apiResponse.status === 403) {
    throw new LocalZoteroApiDisabledError(
      'Local Zotero API is disabled. In Zotero, enable "Allow other applications on this computer to communicate with Zotero" under Settings > Advanced.',
      apiResponse.status,
    );
  }

  if (apiResponse.status < 200 || apiResponse.status >= 300) {
    throw new LocalZoteroApiError(
      apiResponse.text ||
        `Local Zotero API request failed with ${apiResponse.status}.`,
      apiResponse.status,
    );
  }

  const apiVersion = parseInteger(
    getHeader(apiResponse.headers, "Zotero-API-Version"),
  );
  if (apiVersion !== LOCAL_ZOTERO_API_VERSION) {
    throw new LocalZoteroApiVersionMismatchError(apiVersion);
  }

  return { apiVersion };
}

export async function loadLocalZoteroLibraries(params: {
  port: number;
  request?: LocalRequest;
}): Promise<{
  userId: string;
  libraries: EnabledLibrary[];
}> {
  await ensureLocalZoteroReady({
    port: params.port,
    request: params.request,
  });

  const [personalResponse, groupsResponse] = await Promise.all([
    requestLocalJson<Record<string, number>>({
      port: params.port,
      path: "/users/0/items/top?format=versions&limit=1&start=0",
      request: params.request,
    }),
    requestPagedLocalArray<LocalApiGroup>({
      port: params.port,
      path: "/users/0/groups?format=json",
      request: params.request,
    }),
  ]);

  const userId = parseUserIdFromLinkHeader(
    getHeader(personalResponse.headers, "Link"),
  );
  if (!userId) {
    throw new LocalZoteroApiError(
      "Local Zotero API did not expose a stable personal library ID.",
    );
  }

  const libraries = [
    buildPersonalLibrary(userId),
    ...groupsResponse
      .map(mapGroupLibrary)
      .filter((library): library is EnabledLibrary => Boolean(library)),
  ];

  return {
    userId,
    libraries: sortEnabledLibraries(libraries),
  };
}

export async function loadLocalZoteroCollections(params: {
  port: number;
  library: EnabledLibrary;
  request?: LocalRequest;
}): Promise<ZoteroCollectionSummary[]> {
  const basePath = buildLibraryBasePath(params.library);
  const response = await requestPagedLocalArray<LocalApiCollection>({
    port: params.port,
    path: `${basePath}/collections?format=json`,
    request: params.request,
  });

  const rawCollections = response
    .map((collection) => ({
      key: collection.data?.key?.trim() || collection.key?.trim() || "",
      name: collection.data?.name?.trim() || "",
      parentCollectionKey:
        typeof collection.data?.parentCollection === "string"
          ? collection.data.parentCollection.trim()
          : null,
    }))
    .filter((collection) => collection.key && collection.name);

  const collectionMap = new Map(
    rawCollections.map((collection) => [collection.key, collection] as const),
  );
  const displayNameCache = new Map<string, string>();

  const buildDisplayName = (collectionKey: string): string => {
    const cached = displayNameCache.get(collectionKey);
    if (cached) {
      return cached;
    }

    const collection = collectionMap.get(collectionKey);
    if (!collection) {
      return collectionKey;
    }

    const displayName = collection.parentCollectionKey
      ? `${buildDisplayName(collection.parentCollectionKey)} / ${collection.name}`
      : collection.name;
    displayNameCache.set(collectionKey, displayName);
    return displayName;
  };

  return rawCollections
    .map((collection) => ({
      key: collection.key,
      name: collection.name,
      parentCollectionKey: collection.parentCollectionKey,
      displayName: buildDisplayName(collection.key),
    }))
    .sort((left, right) => left.displayName.localeCompare(right.displayName));
}

export async function loadLocalZoteroCatalogPage(params: {
  port: number;
  library: EnabledLibrary;
  start: number;
  limit: number;
  collectionKey?: string | null;
  request?: LocalRequest;
}): Promise<ZoteroLibraryCatalogPageResponse> {
  const basePath = buildLibraryBasePath(params.library);
  const scopePath = params.collectionKey
    ? `${basePath}/collections/${encodeURIComponent(params.collectionKey)}/items/top`
    : `${basePath}/items/top`;
  const response = await requestLocalJson<LocalCatalogItem[]>({
    port: params.port,
    path: `${scopePath}?format=json&sort=dateAdded&direction=asc&limit=${params.limit}&start=${params.start}`,
    request: params.request,
  });

  const totalResults = parseInteger(
    getHeader(response.headers, "Total-Results"),
  );
  const snapshotLibraryVersion = parseInteger(
    getHeader(response.headers, "Last-Modified-Version"),
  );
  const items = response.data.filter(isSyncableTopLevelItem).map((item) => ({
    key: item.key,
    version: item.version,
  }));
  const nextStart = params.start + response.data.length;
  const hasMore =
    totalResults !== null
      ? nextStart < totalResults
      : response.data.length === params.limit;

  return {
    library: {
      type: params.library.type,
      id: params.library.id,
      identity: buildLibraryIdentity(params.library.type, params.library.id),
    },
    snapshotLibraryVersion,
    totalResults,
    items,
    start: params.start,
    limit: params.limit,
    nextStart: hasMore ? nextStart : null,
    hasMore,
  };
}

function buildTopLevelItemsPath(params: {
  library: EnabledLibrary;
  collectionKey?: string | null;
}): string {
  const basePath = buildLibraryBasePath(params.library);
  return params.collectionKey
    ? `${basePath}/collections/${encodeURIComponent(params.collectionKey)}/items/top`
    : `${basePath}/items/top`;
}

function buildVersionItemsPath(params: {
  library: EnabledLibrary;
  collectionKey?: string | null;
  topLevelOnly?: boolean;
}): string {
  if (params.topLevelOnly !== false) {
    return buildTopLevelItemsPath(params);
  }

  const basePath = buildLibraryBasePath(params.library);
  return params.collectionKey
    ? `${basePath}/collections/${encodeURIComponent(params.collectionKey)}/items`
    : `${basePath}/items`;
}

export async function loadLocalZoteroLibraryVersion(params: {
  port: number;
  library: EnabledLibrary;
  collectionKey?: string | null;
  topLevelOnly?: boolean;
  request?: LocalRequest;
}): Promise<number | null> {
  const scopePath = buildVersionItemsPath(params);
  const response = await requestLocalJson<Record<string, number>>({
    port: params.port,
    path: `${scopePath}?format=versions&limit=1&start=0`,
    request: params.request,
  });

  return parseInteger(getHeader(response.headers, "Last-Modified-Version"));
}

export async function loadLocalZoteroItemVersions(params: {
  port: number;
  library: EnabledLibrary;
  collectionKey?: string | null;
  topLevelOnly?: boolean;
  request?: LocalRequest;
}): Promise<{
  libraryVersion: number | null;
  itemVersions: Record<string, number>;
}> {
  const limit = 500;
  const scopePath = buildVersionItemsPath(params);
  const itemVersions: Record<string, number> = {};
  let start = 0;
  let libraryVersion: number | null = null;

  while (true) {
    const response = await requestLocalJson<Record<string, number>>({
      port: params.port,
      path: `${scopePath}?format=versions&limit=${limit}&start=${start}`,
      request: params.request,
    });
    const responseVersion = parseInteger(
      getHeader(response.headers, "Last-Modified-Version"),
    );
    if (responseVersion !== null) {
      libraryVersion = responseVersion;
    }

    const entries = Object.entries(response.data).filter(
      ([itemKey, version]) =>
        typeof itemKey === "string" &&
        Boolean(itemKey.trim()) &&
        typeof version === "number" &&
        Number.isFinite(version),
    );
    for (const [itemKey, version] of entries) {
      itemVersions[itemKey] = version;
    }

    if (entries.length < limit) {
      return {
        libraryVersion,
        itemVersions,
      };
    }

    start += entries.length;
  }
}

export async function loadLocalZoteroItemDetail(params: {
  port: number;
  userId: string;
  library: EnabledLibrary;
  itemKey: string;
  request?: LocalRequest;
}): Promise<ZoteroItemDetail> {
  const basePath = buildLibraryBasePath(params.library);
  const library: ZoteroItemDetail["library"] = {
    type: params.library.type,
    id: params.library.id,
    zoteroUriSegment: params.library.type === "user" ? "library" : "groups",
    identity: buildLibraryIdentity(params.library.type, params.library.id),
    groupName: params.library.type === "group" ? params.library.name : null,
  };

  const [parentResponse, childrenResponse] = await Promise.all([
    requestLocalJson<LocalApiItem>({
      port: params.port,
      path: `${basePath}/items/${encodeURIComponent(params.itemKey)}?format=json&include=data,bib&style=apa`,
      request: params.request,
    }),
    requestLocalJson<LocalApiItem[]>({
      port: params.port,
      path: `${basePath}/items/${encodeURIComponent(params.itemKey)}/children?format=json&limit=500`,
      request: params.request,
    }),
  ]);

  const parentItem = parentResponse.data;
  const children = childrenResponse.data;
  const attachments = children.filter(
    (child) => child.data.itemType === "attachment",
  );
  const collections = await fetchCollectionNameMap({
    port: params.port,
    library: params.library,
    keys: parentItem.data.collections ?? [],
    request: params.request,
  });
  const annotations = await fetchLocalAnnotationsForAttachments({
    port: params.port,
    library: params.library,
    attachments,
    request: params.request,
  });

  return normalizeZoteroItemDetail({
    zoteroUserId: params.userId,
    library,
    parentItem,
    childItems: children,
    collections,
    annotationItems: annotations,
  });
}
