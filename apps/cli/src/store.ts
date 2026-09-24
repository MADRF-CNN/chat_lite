import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { UserSummary } from "@chat-lite/shared";

export type Identity = { privateKey: string; publicKey: string };
export type Config = { apiUrl: string; user: UserSummary; caPath?: string };
export type Secrets = { refreshToken?: string; identities: Record<string, Identity> };

export function configDir() {
  if (process.env.CHAT_LITE_HOME) return process.env.CHAT_LITE_HOME;
  return join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "chat-lite");
}

function configPath() { return join(configDir(), "config.json"); }
function secretsPath() { return join(configDir(), "secrets.json"); }

function readJson<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
}

function writeJson(path: string, value: unknown) {
  mkdirSync(configDir(), { recursive: true, mode: 0o700 });
  chmodSync(configDir(), 0o700);
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
}

export function readConfig() { return readJson<Config>(configPath()); }
export function readSecrets(): Secrets { return readJson<Secrets>(secretsPath()) ?? { identities: {} }; }
export function writeConfig(config: Config) { writeJson(configPath(), config); }
export function writeSecrets(secrets: Secrets) { writeJson(secretsPath(), secrets); }

export function rememberCa(): string | null {
  const caPath = process.env.NODE_EXTRA_CA_CERTS;
  const config = readConfig();
  if (!caPath || !config || config.caPath === caPath) return null;
  writeConfig({ ...config, caPath });
  return caPath;
}

export function findDesktopIdentity(userId: string): Identity | null {
  const home = homedir();
  const safeName = userId.replace(/[^a-zA-Z0-9_-]/g, "_");
  const filename = `identity_${safeName}`;
  const candidates = [
    join(home, "Library", "Application Support", "com.chatlite.desktop", "secrets", filename),
    join(home, "Library", "Application Support", "com.chat-lite.desktop", "secrets", filename),
    join(home, ".local", "share", "com.chatlite.desktop", "secrets", filename),
    join(home, ".config", "com.chatlite.desktop", "secrets", filename),
    join(home, "AppData", "Roaming", "com.chatlite.desktop", "secrets", filename),
  ];
  for (const candidate of candidates) {
    const data = readJson<Identity>(candidate);
    if (data?.privateKey && data?.publicKey) return data;
  }
  return null;
}

export function clearConfig() {
  rmSync(configPath(), { force: true });
}
