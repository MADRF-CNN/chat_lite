import type { AuthResponse } from "@chat-lite/shared";
import { invoke } from "@tauri-apps/api/core";
import { isLoopbackEndpoint, isSecureEndpoint } from "./transport";

export const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3000";
export const SOCKET_URL = import.meta.env.VITE_SOCKET_URL ?? API_URL;
const tauriBridge = {
  saveRefreshToken: (token: string | null) => invoke<void>("save_refresh_token", { token }),
  loadRefreshToken: () => invoke<string | null>("load_refresh_token"),
  saveSecureValue: (name: string, value: string | null) => invoke<void>("save_secure_value", { name, value }),
  loadSecureValue: (name: string) => invoke<string | null>("load_secure_value", { name }),
  saveFile: (name: string, bytes: Uint8Array) => invoke<boolean>("save_file", { name, bytes: Array.from(bytes) }),
};

export const desktopBridge = ("__TAURI_INTERNALS__" in window ? tauriBridge : window.desktop) ?? {
  saveRefreshToken: async (token: string | null) => token ? sessionStorage.setItem("refreshToken", token) : sessionStorage.removeItem("refreshToken"),
  loadRefreshToken: async () => sessionStorage.getItem("refreshToken"),
  saveSecureValue: async (name: string, value: string | null) => value ? localStorage.setItem(`secure:${name}`, value) : localStorage.removeItem(`secure:${name}`),
  loadSecureValue: async (name: string) => localStorage.getItem(`secure:${name}`),
  saveFile: async (name: string, bytes: Uint8Array) => {
    const copy = new ArrayBuffer(bytes.byteLength); new Uint8Array(copy).set(bytes);
    const url = URL.createObjectURL(new Blob([copy]));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = name; anchor.click();
    URL.revokeObjectURL(url); return true;
  },
};
let accessToken: string | null = null;
let refreshPromise: Promise<boolean> | null = null;

export function assertSecureTransport(url: string) {
  if (!import.meta.env.PROD) return;
  if (!isSecureEndpoint(url) && !isLoopbackEndpoint(url)) throw new Error("正式客户端只允许连接 HTTPS/WSS 服务");
}

export function setAccessToken(token: string | null) { accessToken = token; }
export function getAccessToken() { return accessToken; }

async function refreshSession() {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      const refreshToken = await desktopBridge.loadRefreshToken();
      if (!refreshToken) return false;
      const response = await fetch(`${API_URL}/api/auth/refresh`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ refreshToken }) });
      if (!response.ok) { await desktopBridge.saveRefreshToken(null); return false; }
      const auth = await response.json() as AuthResponse;
      accessToken = auth.accessToken;
      await desktopBridge.saveRefreshToken(auth.refreshToken);
      localStorage.setItem("currentUser", JSON.stringify(auth.user));
      return true;
    })().finally(() => { refreshPromise = null; });
  }
  return refreshPromise;
}

export async function api<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  assertSecureTransport(API_URL);
  const headers = new Headers(init.headers);
  if (!(init.body instanceof FormData)) headers.set("Content-Type", "application/json");
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
  const response = await fetch(`${API_URL}/api${path}`, { ...init, headers });
  if (response.status === 401 && retry && await refreshSession()) return api<T>(path, init, false);
  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: "请求失败" }));
    throw new Error(Array.isArray(error.message) ? error.message.join("；") : error.message);
  }
  return response.json() as Promise<T>;
}

export async function authenticate(path: "login" | "register", body: object) {
  const auth = await api<AuthResponse>(`/auth/${path}`, { method: "POST", body: JSON.stringify(body) }, false);
  setAccessToken(auth.accessToken);
  await desktopBridge.saveRefreshToken(auth.refreshToken);
  localStorage.setItem("currentUser", JSON.stringify(auth.user));
  return auth;
}

export async function authenticatedImage(id: string, variant: "thumbnail" | "original") {
  assertSecureTransport(API_URL);
  const response = await fetch(`${API_URL}/api/attachments/${id}/${variant}`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!response.ok) throw new Error("图片加载失败");
  return response.blob();
}

export { refreshSession };
