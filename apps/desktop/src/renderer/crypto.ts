import type { ConversationDto, EncryptedAttachmentMetadata, EncryptedMessageContent, MessageDto, UserSummary } from "@chat-lite/shared";
import { api, authenticatedImage, desktopBridge } from "./api";

type Identity = { privateKey: string; publicKey: string };
type KeyEnvelope = { version: number; encryptedKey: string | null; memberIds: string[] };

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const keyCache = new Map<string, CryptoKey>();
let identity: Identity | null = null;
let identityUserId: string | null = null;

function toBase64(bytes: Uint8Array) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function fromBase64(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function exactBuffer(bytes: Uint8Array) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function importPrivateKey(value: string) {
  return crypto.subtle.importKey("pkcs8", exactBuffer(fromBase64(value)), { name: "RSA-OAEP", hash: "SHA-256" }, false, ["decrypt"]);
}

async function importPublicKey(value: string) {
  return crypto.subtle.importKey("spki", exactBuffer(fromBase64(value)), { name: "RSA-OAEP", hash: "SHA-256" }, false, ["encrypt"]);
}

export async function ensureIdentity(user: UserSummary) {
  if (identity && identityUserId === user.id) return identity;
  const storageName = `identity:${user.id}`;
  const stored = await desktopBridge.loadSecureValue(storageName);
  if (stored) {
    identity = JSON.parse(stored) as Identity;
  } else {
    const pair = await crypto.subtle.generateKey({ name: "RSA-OAEP", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["encrypt", "decrypt"]);
    identity = {
      privateKey: toBase64(new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey))),
      publicKey: toBase64(new Uint8Array(await crypto.subtle.exportKey("spki", pair.publicKey))),
    };
    await desktopBridge.saveSecureValue(storageName, JSON.stringify(identity));
  }
  identityUserId = user.id;
  await api("/users/me/public-key", { method: "PUT", body: JSON.stringify({ publicKey: identity.publicKey }) });
  return identity;
}

async function unwrapKey(conversationId: string, envelope: KeyEnvelope) {
  if (!identity || !envelope.encryptedKey) throw new Error("本机没有该会话的解密密钥");
  const privateKey = await importPrivateKey(identity.privateKey);
  const raw = await crypto.subtle.decrypt({ name: "RSA-OAEP" }, privateKey, exactBuffer(fromBase64(envelope.encryptedKey)));
  const key = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
  keyCache.set(`${conversationId}:${envelope.version}`, key);
  return key;
}

async function rotateConversationKey(conversation: ConversationDto) {
  if (!identity) throw new Error("端到端加密身份尚未初始化");
  const keys = await api<{ id: string; publicKey: string | null }[]>(`/users/keys?ids=${encodeURIComponent(conversation.members.map((member) => member.id).join(","))}`);
  if (keys.length !== conversation.members.length || keys.some((item) => !item.publicKey)) throw new Error("部分成员尚未启用端到端加密，请让对方先登录新版客户端");
  const raw = crypto.getRandomValues(new Uint8Array(32));
  const aesKey = await crypto.subtle.importKey("raw", exactBuffer(raw), "AES-GCM", false, ["encrypt", "decrypt"]);
  const envelopes = await Promise.all(keys.map(async (item) => ({
    userId: item.id,
    encryptedKey: toBase64(new Uint8Array(await crypto.subtle.encrypt({ name: "RSA-OAEP" }, await importPublicKey(item.publicKey!), exactBuffer(raw)))),
  })));
  let created: KeyEnvelope;
  try {
    created = await api<KeyEnvelope>(`/conversations/${conversation.id}/keys`, { method: "POST", body: JSON.stringify({ envelopes }) });
  } catch {
    const latest = await api<KeyEnvelope | null>(`/conversations/${conversation.id}/keys/latest`);
    if (!latest?.encryptedKey || latest.memberIds.join(":") !== conversation.members.map((member) => member.id).sort().join(":")) throw new Error("会话密钥创建失败，请重试");
    return { key: await unwrapKey(conversation.id, latest), version: latest.version };
  }
  keyCache.set(`${conversation.id}:${created.version}`, aesKey);
  return { key: aesKey, version: created.version };
}

export async function conversationKey(conversation: ConversationDto, version?: number) {
  if (version) {
    const cached = keyCache.get(`${conversation.id}:${version}`);
    if (cached) return { key: cached, version };
    return { key: await unwrapKey(conversation.id, await api<KeyEnvelope>(`/conversations/${conversation.id}/keys/${version}`)), version };
  }
  const latest = await api<KeyEnvelope | null>(`/conversations/${conversation.id}/keys/latest`);
  const members = conversation.members.map((member) => member.id).sort().join(":");
  if (latest && latest.encryptedKey && latest.memberIds.join(":") === members) {
    const cached = keyCache.get(`${conversation.id}:${latest.version}`);
    if (cached) return { key: cached, version: latest.version };
    try { return { key: await unwrapKey(conversation.id, latest), version: latest.version }; } catch { /* rotate after a local key replacement */ }
  }
  return rotateConversationKey(conversation);
}

export async function encryptContent(conversation: ConversationDto, content: EncryptedMessageContent, keyVersion?: number) {
  const { key, version } = await conversationKey(conversation, keyVersion);
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, encoder.encode(JSON.stringify(content)));
  return { ciphertext: toBase64(new Uint8Array(ciphertext)), nonce: toBase64(nonce), keyVersion: version };
}

export async function decryptMessage(message: MessageDto, conversation: ConversationDto): Promise<MessageDto> {
  if (!message.ciphertext || !message.nonce || !message.keyVersion) return message;
  try {
    const { key } = await conversationKey(conversation, message.keyVersion);
    const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64(message.nonce) }, key, exactBuffer(fromBase64(message.ciphertext)));
    const content = JSON.parse(decoder.decode(plaintext)) as EncryptedMessageContent;
    return { ...message, text: content.text ?? null, attachments: content.attachments.map((item) => ({ ...item, encrypted: true })) };
  } catch {
    return { ...message, text: "[无法解密的消息]", attachments: [] };
  }
}

async function encryptBytes(key: CryptoKey, bytes: Uint8Array) {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, exactBuffer(bytes));
  return { bytes: new Uint8Array(ciphertext), nonce: toBase64(nonce) };
}

async function thumbnail(file: File) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 480 / bitmap.width, 480 / bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("缩略图生成失败")), "image/webp", 0.8));
  return { blob, width: canvas.width, height: canvas.height };
}

export async function encryptImage(file: File, conversation: ConversationDto) {
  if (file.size > 10 * 1024 * 1024) throw new Error("图片不能超过 10MB");
  if (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(file.type)) throw new Error("仅支持 JPEG、PNG、WebP 和 GIF");
  const bitmap = await createImageBitmap(file); const width = bitmap.width; const height = bitmap.height; bitmap.close();
  const preview = await thumbnail(file);
  const { key, version } = await conversationKey(conversation);
  const original = await encryptBytes(key, new Uint8Array(await file.arrayBuffer()));
  const thumb = await encryptBytes(key, new Uint8Array(await preview.blob.arrayBuffer()));
  const data = new FormData();
  data.append("encrypted", "true");
  data.append("file", new Blob([exactBuffer(original.bytes)], { type: "application/octet-stream" }), "encrypted.bin");
  data.append("thumbnail", new Blob([exactBuffer(thumb.bytes)], { type: "application/octet-stream" }), "thumbnail.bin");
  const uploaded = await api<{ id: string }>("/attachments", { method: "POST", body: data });
  const metadata: EncryptedAttachmentMetadata = { id: uploaded.id, originalName: file.name, mimeType: file.type, size: file.size, width, height, originalNonce: original.nonce, thumbnailNonce: thumb.nonce };
  return { metadata, keyVersion: version };
}

export async function decryptImage(attachment: EncryptedAttachmentMetadata, conversation: ConversationDto, variant: "thumbnail" | "original", keyVersion: number) {
  const encrypted = await authenticatedImage(attachment.id, variant);
  const { key } = await conversationKey(conversation, keyVersion);
  const nonce = variant === "thumbnail" ? attachment.thumbnailNonce : attachment.originalNonce;
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64(nonce) }, key, await encrypted.arrayBuffer());
  return new Blob([plaintext], { type: variant === "thumbnail" ? "image/webp" : attachment.mimeType });
}
