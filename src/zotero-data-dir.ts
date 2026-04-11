type RuntimePlatform = string;
type ProcessEnvLike = {
  HOME?: string;
  USERPROFILE?: string;
};

function getRuntimeProcess(): {
  platform?: string;
  env?: ProcessEnvLike;
} | null {
  if (typeof globalThis !== "object" || !("process" in globalThis)) {
    return null;
  }

  const runtime = (
    globalThis as {
      process?: {
        platform?: string;
        env?: ProcessEnvLike;
      };
    }
  ).process;
  return runtime ?? null;
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
