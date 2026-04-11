import { Notice, Platform, type ObsidianProtocolData } from "obsidian";
import {
  createPendingAuth,
  matchPendingAuth,
  shouldActivateViewAfterAuth,
} from "./auth-flow";
import { PLUGIN_WEB_APP_URL } from "./build-config";
import { BackendClient } from "./backend-client";
import { PLUGIN_NAME } from "./constants";
import { log } from "./log";
import { shouldRefreshLocalSyncAfterCloudConnection } from "./local-sync-rules";
import {
  getStoredAuthSession,
  persistAuthSessionSecrets,
} from "./plugin-persistence";
import {
  applyLastKnownZoteroSnapshot,
  updateLastKnownZoteroSnapshot,
} from "./plugin-sync-helpers";
import {
  buildPersonalLibrary,
  reconcileLibrariesFromConnection,
  setSelectedSearchLibrary,
} from "./plugin-libraries";
import { clearLocalSyncState } from "./plugin-local-sync";
import type StratumPlugin from "./plugin";
import type { PendingAuthFlow, PendingAuthReturnTarget } from "./settings-data";

/**
 * Hydrate `plugin.zoteroConnection` from locally cached settings so the view
 * renders "Find a paper" immediately instead of flashing "Finish setup".
 * Called once during `onload`, before any network calls.  The background
 * `bootstrapRemoteState` will reconcile with the server and correct the state
 * if the session or Zotero token has been revoked.
 */
export function hydrateZoteroConnectionFromCache(plugin: StratumPlugin): void {
  if (!plugin.backend.hasSession()) {
    return;
  }

  const {
    lastKnownZoteroUserId,
    lastKnownZoteroUsername,
    lastKnownZoteroConfirmedAt,
  } = plugin.settings;

  if (!lastKnownZoteroUserId) {
    return;
  }

  plugin.zoteroConnection = {
    connected: true,
    tokenValid: null,
    zoteroUserId: lastKnownZoteroUserId,
    zoteroUsername: lastKnownZoteroUsername,
    lastSyncedAt: lastKnownZoteroConfirmedAt,
    groupsLoaded: false,
    groups: [],
  };
}

export function createBackendClient(plugin: StratumPlugin): BackendClient {
  return new BackendClient({
    initialSession: getStoredAuthSession(plugin),
    onSessionChange: async (session) => {
      persistAuthSessionSecrets(plugin, session);
      plugin.settings.authSessionExpiresAt = session?.expiresAt ?? null;
      await plugin.saveSettings();
    },
    onUserChange: async (user) => {
      const nextEmail = user?.email ?? null;
      const previousEmail = plugin.settings.accountEmail;
      let changed = false;

      if (previousEmail !== nextEmail) {
        plugin.settings.accountEmail = nextEmail;
        changed = true;
      }

      const shouldClearZoteroSnapshot =
        nextEmail === null ||
        (previousEmail !== null &&
          nextEmail !== null &&
          previousEmail !== nextEmail);

      if (
        plugin.settings.pendingAuth &&
        (nextEmail === null || nextEmail !== previousEmail)
      ) {
        plugin.settings.pendingAuth = null;
        changed = true;
      }

      if (shouldClearZoteroSnapshot) {
        if (plugin.settings.lastKnownZoteroUserId !== null) {
          plugin.settings.lastKnownZoteroUserId = null;
          changed = true;
        }
        if (plugin.settings.lastKnownZoteroUsername !== null) {
          plugin.settings.lastKnownZoteroUsername = null;
          changed = true;
        }
        if (plugin.settings.lastKnownZoteroConfirmedAt !== null) {
          plugin.settings.lastKnownZoteroConfirmedAt = null;
          changed = true;
        }
        if (plugin.zoteroConnection !== null) {
          plugin.zoteroConnection = null;
          changed = true;
        }
        if (plugin.availableGroups.length > 0) {
          plugin.availableGroups = [];
          changed = true;
        }
        if (plugin.settings.enabledLibraries.length > 0) {
          plugin.settings.enabledLibraries = [];
          changed = true;
        }
        if (Object.keys(plugin.settings.libraryAutoSync).length > 0) {
          plugin.settings.libraryAutoSync = {};
          changed = true;
        }
        if (Object.keys(plugin.settings.libraryBulkSync).length > 0) {
          plugin.settings.libraryBulkSync = {};
          changed = true;
        }
        if (plugin.settings.activeBulkSyncLibrary !== null) {
          plugin.settings.activeBulkSyncLibrary = null;
          changed = true;
        }
        if (plugin.selectedSearchLibrary !== null) {
          setSelectedSearchLibrary(plugin, null);
          changed = true;
        }
        if (plugin.librarySearchCache.size > 0) {
          plugin.librarySearchCache.clear();
          changed = true;
        }
        if (plugin.localSyncLibraries.length > 0 || plugin.localZoteroUserId) {
          clearLocalSyncState(plugin);
          changed = true;
        }
      }

      if (nextEmail) {
        if (!plugin.settings.accountLinkedAt) {
          plugin.settings.accountLinkedAt = new Date().toISOString();
          changed = true;
        }
      } else {
        if (plugin.settings.accountLinkedAt !== null) {
          plugin.settings.accountLinkedAt = null;
          changed = true;
        }

        if (plugin.zoteroConnection !== null) {
          plugin.zoteroConnection = null;
          changed = true;
        }
      }

      if (changed) {
        await plugin.saveSettings();
        await plugin.reconcileLocalLiveSync();
        plugin.refreshAutoSyncUi();
        plugin.refreshViews();
        plugin.refreshSettingTab();
      }
    },
  });
}

async function beginAuthFlow(params: {
  plugin: StratumPlugin;
  flow: PendingAuthFlow;
  returnTarget: PendingAuthReturnTarget;
  searchParams?: Record<string, string>;
}): Promise<void> {
  const deviceCode = crypto.randomUUID();
  params.plugin.settings.pendingAuth = createPendingAuth({
    code: deviceCode,
    flow: params.flow,
    returnTarget: params.returnTarget,
  });
  await params.plugin.saveSettings();
  params.plugin.refreshViews();
  params.plugin.refreshSettingTab();

  const url = new URL(`${PLUGIN_WEB_APP_URL}/link`);
  url.searchParams.set("code", deviceCode);
  for (const [key, value] of Object.entries(params.searchParams ?? {})) {
    url.searchParams.set(key, value);
  }

  window.open(url.toString(), "_blank", "noopener,noreferrer");
}

export async function startDeviceHandoff(plugin: StratumPlugin): Promise<void> {
  await beginAuthFlow({
    plugin,
    flow: "stratum-sign-in",
    returnTarget: "stay-settings",
  });
  new Notice(`${PLUGIN_NAME}: opened browser sign-in for device handoff.`);
}

export async function startZoteroConnect(plugin: StratumPlugin): Promise<void> {
  await beginAuthFlow({
    plugin,
    flow: "zotero-connect",
    returnTarget: "stay-settings",
    searchParams: {
      flow: "zotero-connect",
    },
  });
  new Notice(`${PLUGIN_NAME}: opened Zotero connect flow in the browser.`);
}

export async function signOutFromPlugin(plugin: StratumPlugin): Promise<void> {
  plugin.settings.pendingAuth = null;
  await plugin.saveSettings();
  await plugin.backend.clearSession();
  new Notice(`${PLUGIN_NAME}: signed out of Stratum on this device.`);
}

export async function refreshZoteroConnection(
  plugin: StratumPlugin,
): Promise<void> {
  log("auth", "refreshing zotero connection");
  if (!plugin.backend.hasSession()) {
    plugin.zoteroConnection = null;
    plugin.isLoadingZoteroConnection = false;
    clearLocalSyncState(plugin);
    plugin.refreshAutoSyncUi();
    plugin.refreshViews();
    plugin.refreshSettingTab();
    return;
  }

  plugin.isLoadingZoteroConnection = true;
  plugin.refreshSettingTab();

  const previousConnection = plugin.zoteroConnection;

  try {
    const nextConnection = await plugin.backend.getZoteroConnectionStatus();
    if (nextConnection) {
      plugin.zoteroConnection = applyLastKnownZoteroSnapshot(
        plugin,
        nextConnection,
      );
      const resolvedConnection = plugin.zoteroConnection;
      let connectionChanged = false;
      if (resolvedConnection?.connected && resolvedConnection.zoteroUserId) {
        if (plugin.settings.enabledLibraries.length === 0) {
          plugin.settings.enabledLibraries = [
            buildPersonalLibrary(resolvedConnection.zoteroUserId),
          ];
          connectionChanged = true;
        }
        if (resolvedConnection.groupsLoaded) {
          connectionChanged =
            reconcileLibrariesFromConnection(plugin, resolvedConnection) ||
            connectionChanged;
        }
        connectionChanged =
          plugin.localSync.reconcileEnabledLibraries() || connectionChanged;
      }
      if (
        updateLastKnownZoteroSnapshot(plugin, plugin.zoteroConnection) ||
        connectionChanged
      ) {
        await plugin.saveSettings();
      }
      if (
        shouldRefreshLocalSyncAfterCloudConnection({
          isDesktopApp: Platform.isDesktopApp,
          hasSession: plugin.backend.hasSession(),
          zoteroConnected: Boolean(resolvedConnection?.connected),
          bulkSyncEnabled: plugin.settings.bulkSyncEnabled,
          bulkSyncPreferenceInitialized:
            plugin.settings.bulkSyncPreferenceInitialized,
        })
      ) {
        await plugin.localSync.refreshLibraries();
      } else if (!resolvedConnection?.connected) {
        clearLocalSyncState(plugin);
      }
    } else {
      plugin.zoteroConnection = plugin.backend.hasSession()
        ? previousConnection
        : null;
      if (!plugin.backend.hasSession()) {
        plugin.availableGroups = [];
        setSelectedSearchLibrary(plugin, null);
        clearLocalSyncState(plugin);
      }
    }
  } catch (error) {
    console.error("stratum: failed to load Zotero connection state", error);
    plugin.zoteroConnection = plugin.backend.hasSession()
      ? previousConnection
      : null;
    if (!plugin.backend.hasSession()) {
      plugin.availableGroups = [];
      setSelectedSearchLibrary(plugin, null);
      clearLocalSyncState(plugin);
    }
  } finally {
    plugin.isLoadingZoteroConnection = false;
    await plugin.reconcileLocalLiveSync();
    const tokenValid = !plugin.backend.hasSession()
      ? "signed_out"
      : (plugin.zoteroConnection?.tokenValid ?? "unknown");
    log("auth", "zotero connection refreshed", {
      connected: Boolean(plugin.zoteroConnection?.connected),
      tokenValid,
    });
    plugin.refreshAutoSyncUi();
    plugin.refreshViews();
    plugin.refreshSettingTab();
  }
}

export async function handleAuthProtocol(
  plugin: StratumPlugin,
  params: ObsidianProtocolData,
): Promise<void> {
  const handoff = typeof params.handoff === "string" ? params.handoff : null;
  const email = typeof params.email === "string" ? params.email : null;
  const zoteroConnected = params.zotero_connected === "true";
  const zoteroUsername =
    typeof params.zotero_username === "string" ? params.zotero_username : null;
  const accessToken =
    typeof params.access_token === "string" ? params.access_token : null;
  const refreshToken =
    typeof params.refresh_token === "string" ? params.refresh_token : null;
  const expiresAtParam =
    typeof params.expires_at === "string" ? params.expires_at : null;
  const pendingAuth = plugin.settings.pendingAuth;
  const authMatch = matchPendingAuth({
    handoff,
    pendingAuth,
  });

  if (authMatch === "missing_handoff") {
    new Notice(`${PLUGIN_NAME}: auth callback received without handoff code.`);
    return;
  }

  if (authMatch === "missing_pending_auth" || authMatch === "mismatch") {
    new Notice(`${PLUGIN_NAME}: ignored an unexpected auth callback.`);
    return;
  }

  if (authMatch === "stale") {
    plugin.settings.pendingAuth = null;
    await plugin.saveSettings();
    plugin.refreshViews();
    plugin.refreshSettingTab();
    new Notice(`${PLUGIN_NAME}: ignored a stale auth callback.`);
    return;
  }

  plugin.settings.pendingAuth = null;
  if (accessToken && refreshToken) {
    const expiresAt = expiresAtParam ? Number(expiresAtParam) : null;
    await plugin.backend.setSession({
      accessToken,
      refreshToken,
      expiresAt: Number.isFinite(expiresAt) ? expiresAt : null,
      email,
    });
  } else if (email) {
    plugin.settings.accountEmail = email;
    plugin.settings.accountLinkedAt = new Date().toISOString();
  }
  await plugin.saveSettings();
  plugin.refreshViews();
  plugin.refreshSettingTab();
  await refreshZoteroConnection(plugin);
  if (shouldActivateViewAfterAuth(pendingAuth)) {
    await plugin.activateView();
  }
  new Notice(
    zoteroConnected
      ? `${PLUGIN_NAME}: Zotero connected${zoteroUsername ? ` as ${zoteroUsername}` : ""}.`
      : email
        ? `${PLUGIN_NAME}: signed in as ${email}.`
        : `${PLUGIN_NAME}: auth callback received for handoff ${handoff}.`,
  );
}

export async function bootstrapRemoteState(
  plugin: StratumPlugin,
): Promise<void> {
  if (!plugin.backend.hasSession()) {
    log("auth", "bootstrap skipped, no session");
    return;
  }

  log("auth", "bootstrapping remote state");
  await refreshZoteroConnection(plugin);
  log("auth", "bootstrap dispatched", {
    connected: Boolean(plugin.zoteroConnection?.connected),
  });
}
