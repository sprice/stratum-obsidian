type RuntimePlatform = string;
type ProcessEnvLike = {
  HOME?: string;
  USERPROFILE?: string;
};
type RuntimeProcess = { platform?: string; env?: ProcessEnvLike };

// Obsidian desktop exposes process; mobile may not.
declare const process: RuntimeProcess | undefined;

function getRuntimeProcess(): RuntimeProcess | null {
  if (typeof process === "undefined") {
    return null;
  }

  return process;
}

function getSeparator(platform: RuntimePlatform): string {
  return platform === "win32" ? "\\" : "/";
}

export function getRuntimePlatform(): RuntimePlatform {
  return getRuntimeProcess()?.platform ?? "darwin";
}

export function resolveHomeDir(env?: ProcessEnvLike | null): string {
  const source = env ?? getRuntimeProcess()?.env ?? {};
  const candidate = source.HOME ?? source.USERPROFILE ?? "";
  return candidate.trim();
}

export function getDefaultZoteroDataDir(options?: {
  platform?: RuntimePlatform;
  homeDir?: string;
}): string {
  const platform = options?.platform ?? getRuntimePlatform();
  const homeDir = options?.homeDir ?? resolveHomeDir();
  if (!homeDir) {
    return "Zotero";
  }

  return `${homeDir.replace(/[\\/]+$/, "")}${getSeparator(platform)}Zotero`;
}
