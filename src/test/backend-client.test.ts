import assert from "node:assert/strict";
import test from "node:test";
import type { RequestUrlParam, RequestUrlResponse } from "obsidian";
import type { BackendClient } from "../backend-client";
import { loadRuntime } from "./runtime-harness";

function response(status: number, json: unknown): RequestUrlResponse {
  return {
    status,
    json,
    text: JSON.stringify(json),
    headers: {},
    arrayBuffer: new ArrayBuffer(0),
  };
}
const expired = { accessToken: "old", refreshToken: "refresh", expiresAt: 1 };
const fresh = {
  accessToken: "new",
  refreshToken: "new-refresh",
  expiresAt: null,
};
const refreshed = {
  access_token: "refreshed",
  refresh_token: "rotated",
  expires_in: 3600,
};
function setup(
  requestUrl: (params: RequestUrlParam) => Promise<RequestUrlResponse>,
  userRequest: (params: RequestUrlParam) => Promise<RequestUrlResponse> = ({
    headers,
  }) =>
    Promise.resolve(
      response(200, {
        id:
          headers?.Authorization === "Bearer other-account"
            ? "account-two"
            : "account-one",
        email:
          headers?.Authorization === "Bearer other-account"
            ? "new@example.test"
            : "first@example.test",
      }),
    ),
) {
  const { BackendClient: Client } = loadRuntime<{
    BackendClient: typeof BackendClient;
  }>("backend-client.ts", {
    requestUrl: (params: RequestUrlParam) =>
      params.url.endsWith("/auth/v1/user")
        ? userRequest(params)
        : requestUrl(params),
  });
  const sessions: unknown[] = [];
  const users: unknown[] = [];
  const client = new Client({
    initialSession: expired,
    onSessionChange: (session) => {
      sessions.push(session);
      return Promise.resolve();
    },
    onUserChange: (user) => {
      users.push(user ? { ...user } : null);
      return Promise.resolve();
    },
  });
  return { client, sessions, users };
}
function deferred() {
  let resolve!: (value: RequestUrlResponse) => void;
  const promise = new Promise<RequestUrlResponse>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("concurrent requests share a single rotating-token refresh", async () => {
  const refresh = deferred();
  let calls = 0;
  const { client } = setup(async ({ url }) => {
    if (url.includes("/token?")) {
      calls++;
      return refresh.promise;
    }
    return response(200, {});
  });
  const requests = [client.authedFetch("/one"), client.authedFetch("/two")];
  assert.equal(calls, 1);
  refresh.resolve(response(200, refreshed));
  await Promise.all(requests);
  assert.equal(client.getSession()?.refreshToken, "rotated");
});

test("sign-out prevents an in-flight refresh from restoring the session", async () => {
  const refresh = deferred();
  const { client, sessions } = setup(() => refresh.promise);
  const request = client.authedFetch("/one");
  await client.clearSession();
  refresh.resolve(response(200, refreshed));
  await assert.rejects(request, /No authenticated/);
  assert.equal(client.getSession(), null);
  assert.deepEqual(sessions, [null]);
});

test("a temporary refresh failure preserves the session and can be retried", async () => {
  let attempts = 0;
  const { client } = setup(({ url }) =>
    Promise.resolve(
      url.includes("/token?")
        ? ++attempts === 1
          ? response(503, {})
          : response(200, refreshed)
        : response(200, {}),
    ),
  );
  await assert.rejects(client.authedFetch("/one"), /could not be refreshed/);
  assert.equal(client.getSession(), expired);
  await client.authedFetch("/one");
  assert.equal(attempts, 2);
});

for (const status of [200, 401]) {
  test(`an old account's ${status} response cannot be used or clear a replacement session`, async () => {
    const pending = deferred();
    const { client } = setup(() => pending.promise);
    await client.setSession(fresh);
    const request = client.authedFetch("/one");
    await Promise.resolve();
    await client.setSession({ ...fresh, accessToken: "other-account" });
    pending.resolve(response(status, {}));
    await assert.rejects(request, /session changed/);
    assert.equal(client.getSession()?.accessToken, "other-account");
  });
}

test("a stale validation response cannot change the active user's email", async () => {
  const pending = deferred();
  let first = true;
  const { client, users } = setup(
    () => pending.promise,
    ({ headers }) => {
      if (headers?.Authorization === "Bearer other-account")
        return Promise.resolve(
          response(200, { id: "account-two", email: "new@example.test" }),
        );
      if (first) {
        first = false;
        return Promise.resolve(
          response(200, { id: "account-one", email: "first@example.test" }),
        );
      }
      return pending.promise;
    },
  );
  await client.setSession(fresh);
  const validation = client.validateSession();
  await Promise.resolve();
  await client.setSession({
    ...fresh,
    accessToken: "other-account",
  });
  pending.resolve(response(200, { email: "old@example.test" }));
  assert.equal(await validation, null);
  assert.equal((users.at(-1) as { email: string }).email, "new@example.test");
});

test("unload invalidates an in-flight refresh without deleting stored authentication", async () => {
  const refresh = deferred();
  const { client, sessions } = setup(() => refresh.promise);
  const request = client.authedFetch("/one");
  client.invalidatePendingRequests();
  refresh.resolve(response(200, refreshed));
  await assert.rejects(request, /No authenticated/);
  assert.equal(client.getSession()?.refreshToken, expired.refreshToken);
  assert.deepEqual(sessions, []);
});

for (const [status, payload, expected] of [
  [500, {}, "Error"],
  [404, {}, "Error"],
  [404, { error: "Zotero item not found." }, "ZoteroItemNotFoundError"],
] as const) {
  test(`item detail ${status} ${JSON.stringify(payload)} has the correct missing-item classification`, async () => {
    const { client } = setup(() => Promise.resolve(response(status, payload)));
    await client.setSession(fresh);
    await assert.rejects(
      client.getZoteroItemDetail("ITEM"),
      (error: unknown) => (error as Error).name === expected,
    );
  });
}

for (const status of [401, 403])
  test(`access ${status} refreshes and retries once without discarding the session`, async () => {
    const calls: string[] = [];
    const { client } = setup(({ url, headers }) => {
      calls.push(url);
      return Promise.resolve(
        response(
          url.includes("/token?")
            ? 200
            : headers?.Authorization === "Bearer refreshed"
              ? 200
              : status,
          url.includes("/token?") ? refreshed : {},
        ),
      );
    });
    await client.setSession(fresh);
    const result = await client.authedFetch("/one");
    assert.equal(result.status, 200);
    assert.equal(calls.length, 3);
    assert.equal(client.getSession()?.refreshToken, "rotated");
  });
test("repeated access rejection stops after one refresh and retains the rotated token", async () => {
  let calls = 0;
  const { client } = setup(({ url }) => {
    calls++;
    return Promise.resolve(
      response(
        url.includes("/token?") ? 200 : 401,
        url.includes("/token?") ? refreshed : {},
      ),
    );
  });
  await client.setSession(fresh);
  assert.equal((await client.authedFetch("/one")).status, 401);
  assert.equal(calls, 3);
  assert.equal(client.getSession()?.refreshToken, "rotated");
});

test("sign-in uses the verified server identity even for opaque tokens and matching emails", async () => {
  const calls: RequestUrlParam[] = [];
  const { client, users } = setup(
    () => Promise.resolve(response(200, {})),
    (params) => {
      calls.push(params);
      return Promise.resolve(
        response(200, {
          id:
            params.headers?.Authorization === "Bearer new"
              ? "account-one"
              : "account-two",
          email: "same@example.test",
        }),
      );
    },
  );
  assert.equal(await client.setSession(fresh), true);
  assert.equal(
    await client.setSession({ ...fresh, accessToken: "other-account" }),
    true,
  );
  assert.deepEqual(users, [
    { id: "account-one", email: "same@example.test" },
    { id: "account-two", email: "same@example.test" },
  ]);
  assert.equal(calls.length, 2);
});

for (const [status, payload] of [
  [401, {}],
  [503, {}],
  [200, {}],
  [200, { id: 1 }],
  [200, { id: "account-two", email: 42 }],
] as const) {
  test(`unverified sign-in (${status}, ${JSON.stringify(payload)}) preserves the existing account`, async () => {
    const { client, users, sessions } = setup(
      () => Promise.resolve(response(200, {})),
      () => Promise.resolve(response(status, payload)),
    );
    await assert.rejects(client.setSession(fresh), /verify|invalid account/);
    assert.equal(client.getSession(), expired);
    assert.deepEqual(users, []);
    assert.deepEqual(sessions, []);
  });
}

test("sign-out prevents a pending sign-in from restoring authentication", async () => {
  const pending = deferred();
  const { client, users, sessions } = setup(
    () => pending.promise,
    () => pending.promise,
  );
  const signIn = client.setSession(fresh);
  await client.clearSession();
  pending.resolve(
    response(200, { id: "account-one", email: "first@example.test" }),
  );
  assert.equal(await signIn, false);
  assert.equal(client.getSession(), null);
  assert.deepEqual(users, [null]);
  assert.deepEqual(sessions, [null]);
});

test("a late sign-in cannot replace a newer account", async () => {
  const pending = deferred();
  const { client, users } = setup(
    () => pending.promise,
    ({ headers }) =>
      headers?.Authorization === "Bearer new"
        ? pending.promise
        : Promise.resolve(
            response(200, { id: "account-two", email: "new@example.test" }),
          ),
  );
  const first = client.setSession(fresh);
  assert.equal(
    await client.setSession({ ...fresh, accessToken: "other-account" }),
    true,
  );
  pending.resolve(
    response(200, { id: "account-one", email: "first@example.test" }),
  );
  assert.equal(await first, false);
  assert.equal(client.getSession()?.accessToken, "other-account");
  assert.deepEqual(users, [{ id: "account-two", email: "new@example.test" }]);
});

test("unload invalidates a pending sign-in without replacing stored tokens", async () => {
  const pending = deferred();
  const { client, users, sessions } = setup(
    () => pending.promise,
    () => pending.promise,
  );
  const signIn = client.setSession(fresh);
  client.invalidatePendingRequests();
  pending.resolve(
    response(200, { id: "account-one", email: "first@example.test" }),
  );
  assert.equal(await signIn, false);
  assert.equal(client.getSession()?.accessToken, expired.accessToken);
  assert.deepEqual(users, []);
  assert.deepEqual(sessions, []);
});

test("a network failure during sign-in leaves the active account intact", async () => {
  const { client, users, sessions } = setup(
    () => Promise.resolve(response(200, {})),
    () => Promise.reject(new Error("Offline")),
  );
  await assert.rejects(client.setSession(fresh), /Offline/);
  assert.equal(client.getSession(), expired);
  assert.deepEqual(users, []);
  assert.deepEqual(sessions, []);
});
