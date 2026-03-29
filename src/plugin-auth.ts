import { Notice, type ObsidianProtocolData } from "obsidian";
import { PLUGIN_WEB_APP_URL } from "./build-config";
import { BackendClient } from "./backend-client";
import { PLUGIN_NAME } from "./constants";
import { log } from "./log";
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
import type StratumPlugin from "./plugin";

/**
 * Hydrate `plugin.zoteroConnection` from locally cached settings so the view
 * renders "Find a paper" immediately instead of flashing "Finish setup".
 * Called once during `onload`, before any network calls.  The background
 * `bootstrapRemoteState` will reconcile with the server and correct the state
 * if the session or Zotero token has been revoked.
 */
export function hydrateZoteroConnectionFromCache(
  plugin: StratumPlugin
): void {
  if (!plugin.backend.hasSession()) {
    return;
  }

  const { lastKnownZoteroUserId, lastKnownZoteroUsername, lastKnownZoteroConfirmedAt } =
    plugin.settings;

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
        plugin.refreshAutoSyncUi();
        plugin.refreshViews();
        plugin.refreshSettingTab();
      }
    },
  });
}

export async function startDeviceHandoff(plugin: StratumPlugin): Promise<void> {
  const deviceCode = crypto.randomUUID();
  plugin.settings.lastDeviceCode = deviceCode;
  await plugin.saveSettings();
  plugin.refreshViews();
  plugin.refreshSettingTab();

  const url = new URL(`${PLUGIN_WEB_APP_URL}/link`);
  url.searchParams.set("code", deviceCode);

  window.open(url.toString(), "_blank", "noopener,noreferrer");
  new Notice(`${PLUGIN_NAME}: opened browser sign-in for device handoff.`);
}

export async function startZoteroConnect(plugin: StratumPlugin): Promise<void> {
  const deviceCode = crypto.randomUUID();
  plugin.settings.lastDeviceCode = deviceCode;
  await plugin.saveSettings();
  plugin.refreshViews();
  plugin.refreshSettingTab();

  const url = new URL(`${PLUGIN_WEB_APP_URL}/link`);
  url.searchParams.set("code", deviceCode);
  url.searchParams.set("flow", "zotero-connect");

  window.open(url.toString(), "_blank", "noopener,noreferrer");
  new Notice(`${PLUGIN_NAME}: opened Zotero connect flow in the browser.`);
}

export async function signOutFromPlugin(plugin: StratumPlugin): Promise<void> {
  plugin.settings.lastDeviceCode = null;
  await plugin.saveSettings();
  await plugin.backend.clearSession();
  new Notice(`${PLUGIN_NAME}: signed out of Stratum on this device.`);
}

export async function refreshZoteroConnection(
  plugin: StratumPlugin
): Promise<void> {
  log("auth", "refreshing zotero connection");
  if (!plugin.backend.hasSession()) {
    plugin.zoteroConnection = null;
    plugin.isLoadingZoteroConnection = false;
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
      plugin.zoteroConnection = applyLastKnownZoteroSnapshot(plugin, nextConnection);
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
      }
      if (
        updateLastKnownZoteroSnapshot(plugin, plugin.zoteroConnection) ||
        connectionChanged
      ) {
        await plugin.saveSettings();
      }
    } else {
      plugin.zoteroConnection = plugin.backend.hasSession()
        ? previousConnection
        : null;
      if (!plugin.backend.hasSession()) {
        plugin.availableGroups = [];
        setSelectedSearchLibrary(plugin, null);
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
    }
  } finally {
    plugin.isLoadingZoteroConnection = false;
    log("auth", "zotero connection refreshed", {
      connected: Boolean(plugin.zoteroConnection?.connected),
      tokenValid: plugin.zoteroConnection?.tokenValid ?? "unknown",
    });
    plugin.refreshAutoSyncUi();
    plugin.refreshViews();
    plugin.refreshSettingTab();
  }
}

export async function handleAuthProtocol(
  plugin: StratumPlugin,
  params: ObsidianProtocolData
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

  if (!handoff) {
    new Notice(`${PLUGIN_NAME}: auth callback received without handoff code.`);
    return;
  }

  const expectedHandoff = plugin.settings.lastDeviceCode;
  if (!expectedHandoff || handoff !== expectedHandoff) {
    new Notice(`${PLUGIN_NAME}: ignored an unexpected auth callback.`);
    return;
  }

  plugin.settings.lastDeviceCode = null;
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
    await plugin.saveSettings();
  }
  plugin.refreshViews();
  plugin.refreshSettingTab();
  await refreshZoteroConnection(plugin);
  if (plugin.settings.autoSyncEnabled) {
    void plugin.runZoteroAutoSync("startup");
  }
  await plugin.activateView();
  new Notice(
    zoteroConnected
      ? `${PLUGIN_NAME}: Zotero connected${zoteroUsername ? ` as ${zoteroUsername}` : ""}.`
      : email
        ? `${PLUGIN_NAME}: signed in as ${email}.`
        : `${PLUGIN_NAME}: auth callback received for handoff ${handoff}.`
  );
}

export async function bootstrapRemoteState(plugin: StratumPlugin): Promise<void> {
  if (!plugin.backend.hasSession()) {
    log("auth", "bootstrap skipped, no session");
    return;
  }

  log("auth", "bootstrapping remote state");
  await refreshZoteroConnection(plugin);
  if (plugin.settings.autoSyncEnabled) {
    void plugin.runZoteroAutoSync("startup");
  }
  log("auth", "bootstrap dispatched", {
    connected: Boolean(plugin.zoteroConnection?.connected),
    autoSyncFired: plugin.settings.autoSyncEnabled,
  });
}
