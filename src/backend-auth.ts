import type { BackendErrorPayload } from "./backend-types";

export function hasAuthenticatedUserRequiredError(
  payload: BackendErrorPayload | null | undefined,
): boolean {
  return (
    typeof payload?.error === "string" &&
    /authenticated user required/i.test(payload.error)
  );
}
