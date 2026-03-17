import { Notice, type ObsidianProtocolData } from "obsidian";
import { PLUGIN_WEB_APP_URL } from "./build-config";
import { BackendClient } from "./backend-client";
import { PLUGIN_NAME } from "./constants";
import {
  getStoredAuthSession,
  persistAuthSessionSecrets,
} from "./plugin-persistence";
import type StratumPlugin from "./plugin";

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
      let changed = false;

      if (plugin.settings.accountEmail !== nextEmail) {
        plugin.settings.accountEmail = nextEmail;
        changed = true;
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

async function ensureAuthenticatedSessionState(
  plugin: StratumPlugin
): Promise<boolean> {
  if (!plugin.backend.hasSession()) {
    return false;
  }

  try {
    const user = await plugin.backend.validateSession();
    if (user) {
      return true;
    }
  } catch (error) {
    console.error("stratum: failed to validate app session", error);
    return plugin.backend.hasSession();
  }

  plugin.zoteroConnection = null;
  plugin.refreshAutoSyncUi();
  plugin.refreshViews();
  plugin.refreshSettingTab();
  return false;
}

export async function refreshZoteroConnection(
  plugin: StratumPlugin
): Promise<void> {
  if (!plugin.backend.hasSession()) {
    plugin.zoteroConnection = null;
    plugin.isLoadingZoteroConnection = false;
    plugin.refreshAutoSyncUi();
    plugin.refreshViews();
    plugin.refreshSettingTab();
    return;
  }

  if (!(await ensureAuthenticatedSessionState(plugin))) {
    plugin.zoteroConnection = null;
    plugin.isLoadingZoteroConnection = false;
    plugin.refreshAutoSyncUi();
    plugin.refreshViews();
    plugin.refreshSettingTab();
    return;
  }

  plugin.isLoadingZoteroConnection = true;
  plugin.refreshViews();
  plugin.refreshSettingTab();

  try {
    plugin.zoteroConnection = await plugin.backend.getZoteroConnectionStatus();
  } catch (error) {
    console.error("stratum: failed to load Zotero connection state", error);
    plugin.zoteroConnection = null;
  } finally {
    plugin.isLoadingZoteroConnection = false;
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
    return;
  }

  await refreshZoteroConnection(plugin);
  if (plugin.settings.autoSyncEnabled) {
    void plugin.runZoteroAutoSync("startup");
  }
}
