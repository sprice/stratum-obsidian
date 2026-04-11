import type {
  PendingAuthFlow,
  PendingAuthReturnTarget,
  PendingAuthState,
} from "./settings-data";

export const PENDING_AUTH_MAX_AGE_MS = 1000 * 60 * 60;

export type PendingAuthMatchStatus =
  | "missing_handoff"
  | "missing_pending_auth"
  | "mismatch"
  | "stale"
  | "matched";

export function createPendingAuth(params: {
  code: string;
  flow: PendingAuthFlow;
  returnTarget: PendingAuthReturnTarget;
  now?: Date;
}): PendingAuthState {
  return {
    code: params.code,
    flow: params.flow,
    returnTarget: params.returnTarget,
    createdAt: (params.now ?? new Date()).toISOString(),
  };
}

export function matchPendingAuth(params: {
  handoff: string | null;
  pendingAuth: PendingAuthState | null;
  now?: number;
  maxAgeMs?: number;
}): PendingAuthMatchStatus {
  if (!params.handoff) {
    return "missing_handoff";
  }

  if (!params.pendingAuth) {
    return "missing_pending_auth";
  }

  if (params.pendingAuth.code !== params.handoff) {
    return "mismatch";
  }

  const createdAt = Date.parse(params.pendingAuth.createdAt);
  if (!Number.isFinite(createdAt)) {
    return "stale";
  }

  const ageMs = (params.now ?? Date.now()) - createdAt;
  if (ageMs < 0) {
    return "matched";
  }

  return ageMs > (params.maxAgeMs ?? PENDING_AUTH_MAX_AGE_MS)
    ? "stale"
    : "matched";
}

export function isPendingAuthStale(params: {
  pendingAuth: PendingAuthState | null;
  now?: number;
  maxAgeMs?: number;
}): boolean {
  if (!params.pendingAuth) {
    return false;
  }

  const createdAt = Date.parse(params.pendingAuth.createdAt);
  if (!Number.isFinite(createdAt)) {
    return true;
  }

  const ageMs = (params.now ?? Date.now()) - createdAt;
  if (ageMs < 0) {
    return false;
  }

  return ageMs > (params.maxAgeMs ?? PENDING_AUTH_MAX_AGE_MS);
}

export function shouldActivateViewAfterAuth(
  pendingAuth: PendingAuthState | null,
): boolean {
  return pendingAuth?.returnTarget === "open-panel-search";
}
