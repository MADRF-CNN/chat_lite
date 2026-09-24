import { randomUUID } from "node:crypto";
import type { AuthResponse, ConversationDto, MessageDto, UserSummary } from "@chat-lite/shared";
import { createE2ee, generateIdentity, type E2ee } from "./crypto";
import { findDesktopIdentity, readConfig, readSecrets, writeConfig, writeSecrets, type Identity, type Secrets } from "./store";
import { info, warn } from "./log";

const FALLBACK_API_URL = "http://localhost:3000";

export function normalizeApiUrl(url: string) {
  let trimmed = url.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(trimmed)) {
    if (/^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(trimmed)) {
      trimmed = `http://${trimmed}`;
    } else {
      trimmed = `https://${trimmed}`;
    }
  }
  return trimmed;
}

export function defaultApiUrl() {
  return normalizeApiUrl(process.env.CHAT_LITE_API_URL || readConfig()?.apiUrl || FALLBACK_API_URL);
}

async function errorMessage(response: Response) {
  const body = await response.json().catch(() => null) as { message?: string | string[] } | null;
  const message = body?.message;
  if (Array.isArray(message)) return message.join("；");
  return message ?? `请求失败（HTTP ${response.status}）`;
}

async function jsonFetch<T>(url: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set("Content-Type", "application/json");
  const response = await fetch(url, { ...init, headers });
  if (!response.ok) throw new Error(await errorMessage(response));
  return response.json() as Promise<T>;
}

class Transport {
  accessToken: string;

  constructor(readonly apiUrl: string, private readonly secrets: Secrets, accessToken: string) {
    this.accessToken = accessToken;
  }

  async request<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
    const headers = new Headers(init.headers);
    if (init.body) headers.set("Content-Type", "application/json");
    if (this.accessToken) headers.set("Authorization", `Bearer ${this.accessToken}`);
    const response = await fetch(`${this.apiUrl}/api${path}`, { ...init, headers });
    if (response.status === 401 && retry && await this.refresh()) return this.request<T>(path, init, false);
    if (!response.ok) throw new Error(await errorMessage(response));
    return response.json() as Promise<T>;
  }

  async fetchBytes(path: string) {
    const response = await fetch(`${this.apiUrl}/api${path}`, { headers: { Authorization: `Bearer ${this.accessToken}` } });
    if (!response.ok) throw new Error(await errorMessage(response));
    return new Uint8Array(await response.arrayBuffer());
  }

  async refresh() {
    const refreshToken = this.secrets.refreshToken;
    if (!refreshToken) return false;
    const response = await fetch(`${this.apiUrl}/api/auth/refresh`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ refreshToken }) });
    if (!response.ok) return false;
    const auth = await response.json() as AuthResponse;
    this.accessToken = auth.accessToken;
    this.secrets.refreshToken = auth.refreshToken;
    writeSecrets(this.secrets);
    return true;
  }
}

async function ensureIdentity(transport: Transport, user: UserSummary, secrets: Secrets): Promise<Identity> {
  let identity = secrets.identities[user.id];
  const desktopIdentity = findDesktopIdentity(user.id);
  if (desktopIdentity && (!identity || identity.publicKey !== desktopIdentity.publicKey)) {
    identity = desktopIdentity;
    secrets.identities[user.id] = identity;
    writeSecrets(secrets);
    info("已自动从本机桌面端同步端到端身份私钥。");
  } else if (!identity) {
    const existing = await transport.request<{ id: string; publicKey: string | null }[]>(`/users/keys?ids=${user.id}`);
    if (existing[0]?.publicKey) warn("本机没有该账号的身份私钥，已生成新的身份密钥；此前收到的加密消息将无法解密。");
    identity = await generateIdentity();
    secrets.identities[user.id] = identity;
    writeSecrets(secrets);
  }
  await transport.request("/users/me/public-key", { method: "PUT", body: JSON.stringify({ publicKey: identity.publicKey }) });
  return identity;
}

export class Client {
  readonly e2ee: E2ee;

  private constructor(
    readonly apiUrl: string,
    readonly user: UserSummary,
    private readonly secrets: Secrets,
    private readonly transport: Transport,
    identity: Identity,
  ) {
    this.e2ee = createE2ee((path, init) => transport.request(path, init), (path) => transport.fetchBytes(path), identity);
  }

  static async authenticate(rawApiUrl: string, path: "login" | "register", body: Record<string, string>) {
    const apiUrl = normalizeApiUrl(rawApiUrl);
    const auth = await jsonFetch<AuthResponse>(`${apiUrl}/api/auth/${path}`, { method: "POST", body: JSON.stringify(body) });
    const secrets = readSecrets();
    secrets.refreshToken = auth.refreshToken;
    const existing = readConfig();
    writeConfig({ apiUrl, user: auth.user, caPath: existing?.caPath });
    writeSecrets(secrets);
    const transport = new Transport(apiUrl, secrets, auth.accessToken);
    return new Client(apiUrl, auth.user, secrets, transport, await ensureIdentity(transport, auth.user, secrets));
  }

  static async restore(apiUrlOverride?: string) {
    const config = readConfig();
    if (!config) throw new Error("本机尚未登录，请先执行 chat-lite login");
    const rawApiUrl = apiUrlOverride ?? config.apiUrl;
    const apiUrl = normalizeApiUrl(rawApiUrl);
    const secrets = readSecrets();
    const transport = new Transport(apiUrl, secrets, "");
    if (!(await transport.refresh())) throw new Error("登录已过期，请重新执行 chat-lite login");
    return new Client(transport.apiUrl, config.user, secrets, transport, await ensureIdentity(transport, config.user, secrets));
  }

  get accessToken() { return this.transport.accessToken; }
  get refreshToken() { return this.secrets.refreshToken ?? null; }

  renewSession() {
    return this.transport.refresh();
  }

  listConversations() {
    return this.transport.request<ConversationDto[]>("/conversations");
  }

  searchUsers(query: string) {
    return this.transport.request<UserSummary[]>(`/users/search?q=${encodeURIComponent(query)}`);
  }

  createDirect(userId: string) {
    return this.transport.request<{ id: string }>("/conversations/direct", { method: "POST", body: JSON.stringify({ userId }) });
  }

  createGroup(name: string, memberIds: string[]) {
    return this.transport.request<{ id: string }>("/conversations/group", { method: "POST", body: JSON.stringify({ name, memberIds }) });
  }

  messages(conversationId: string, cursor?: string, limit = 30) {
    const query = new URLSearchParams({ limit: String(limit) });
    if (cursor) query.set("cursor", cursor);
    return this.transport.request<{ items: MessageDto[]; nextCursor: string | null }>(`/conversations/${conversationId}/messages?${query}`);
  }

  sendMessage(conversationId: string, ciphertext: string, nonce: string, keyVersion: number, clientId = randomUUID()) {
    return this.transport.request<MessageDto>(`/conversations/${conversationId}/messages`, {
      method: "POST",
      body: JSON.stringify({ clientId, ciphertext, nonce, keyVersion, attachmentIds: [] }),
    });
  }

  markRead(conversationId: string, messageId: string) {
    return this.transport.request<{ ok: boolean }>(`/conversations/${conversationId}/read`, { method: "POST", body: JSON.stringify({ messageId }) });
  }

  async logout() {
    if (this.secrets.refreshToken) {
      await this.transport.request("/auth/logout", { method: "POST", body: JSON.stringify({ refreshToken: this.secrets.refreshToken }) }).catch(() => undefined);
    }
    delete this.secrets.refreshToken;
    writeSecrets(this.secrets);
  }

  async findUser(name: string) {
    const users = await this.searchUsers(name);
    const exact = users.filter((user) => user.username.toLowerCase() === name.toLowerCase() || user.displayName === name);
    if (exact.length > 1) throw new Error(`“${name}”匹配到多个用户，请改用 username`);
    if (exact.length === 1) return exact[0]!;
    throw new Error(`找不到用户“${name}”`);
  }

  async resolveConversation(target: string): Promise<ConversationDto> {
    const conversations = await this.listConversations();
    const byId = conversations.filter((item) => item.id === target);
    const byPrefix = byId.length ? [] : conversations.filter((item) => item.id.startsWith(target));
    const byMember = byId.length || byPrefix.length ? [] : conversations.filter((item) => {
      if (item.type !== "DIRECT") return false;
      const other = item.members.find((member) => member.id !== this.user.id);
      return Boolean(other && (other.username.toLowerCase() === target.toLowerCase() || other.displayName === target));
    });
    const byName = byId.length || byPrefix.length || byMember.length ? [] : conversations.filter((item) => item.name === target);
    const matches = byId.length ? byId : byPrefix.length ? byPrefix : byMember.length ? byMember : byName;
    if (matches.length > 1) throw new Error(`“${target}”匹配到多个会话，请改用会话 ID：\n${matches.map((item) => `  ${item.id}  ${conversationLabel(item, this.user)}`).join("\n")}`);
    if (matches.length === 1) return matches[0]!;
    const user = (await this.searchUsers(target)).find((item) => item.username.toLowerCase() === target.toLowerCase() || item.displayName === target);
    if (user) {
      const created = await this.createDirect(user.id);
      const conversation = (await this.listConversations()).find((item) => item.id === created.id);
      if (!conversation) throw new Error("会话创建失败，请重试");
      info(`已创建与 ${user.displayName} 的私聊`);
      return conversation;
    }
    throw new Error(`找不到会话或用户“${target}”，可用 chat-lite list 查看会话`);
  }
}

export function conversationLabel(conversation: ConversationDto, me: UserSummary) {
  if (conversation.type === "GROUP") return conversation.name ?? "未命名群聊";
  return conversation.members.find((member) => member.id !== me.id)?.displayName ?? "私聊";
}
