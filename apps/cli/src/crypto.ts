import { webcrypto } from "node:crypto";
import type { ConversationDto, EncryptedAttachmentMetadata, EncryptedMessageContent, MessageDto } from "@chat-lite/shared";

export type Identity = { privateKey: string; publicKey: string };
export type JsonRequest = <T>(path: string, init?: RequestInit) => Promise<T>;
export type FetchBytes = (path: string) => Promise<Uint8Array>;

export type DecryptedMessage = { message: MessageDto; content: EncryptedMessageContent | null };
export type E2ee = ReturnType<typeof createE2ee>;

type KeyEnvelope = { version: number; encryptedKey: string | null; memberIds: string[] };

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toBase64(bytes: Uint8Array) {
  return Buffer.from(bytes).toString("base64");
}

function fromBase64(value: string) {
  return new Uint8Array(Buffer.from(value, "base64"));
}

function exactBuffer(bytes: Uint8Array) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

export async function generateIdentity(): Promise<Identity> {
  const pair = await webcrypto.subtle.generateKey(
    { name: "RSA-OAEP", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["encrypt", "decrypt"],
  );
  return {
    privateKey: toBase64(new Uint8Array(await webcrypto.subtle.exportKey("pkcs8", pair.privateKey))),
    publicKey: toBase64(new Uint8Array(await webcrypto.subtle.exportKey("spki", pair.publicKey))),
  };
}

async function importPrivateKey(value: string) {
  return webcrypto.subtle.importKey("pkcs8", exactBuffer(fromBase64(value)), { name: "RSA-OAEP", hash: "SHA-256" }, false, ["decrypt"]);
}

async function importPublicKey(value: string) {
  return webcrypto.subtle.importKey("spki", exactBuffer(fromBase64(value)), { name: "RSA-OAEP", hash: "SHA-256" }, false, ["encrypt"]);
}

export function createE2ee(request: JsonRequest, fetchBytes: FetchBytes, identity: Identity) {
  const keyCache = new Map<string, webcrypto.CryptoKey>();

  async function unwrapKey(conversationId: string, envelope: KeyEnvelope) {
    if (!envelope.encryptedKey) throw new Error("本机没有该会话的解密密钥");
    const privateKey = await importPrivateKey(identity.privateKey);
    const raw = await webcrypto.subtle.decrypt({ name: "RSA-OAEP" }, privateKey, exactBuffer(fromBase64(envelope.encryptedKey)));
    const key = await webcrypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
    keyCache.set(`${conversationId}:${envelope.version}`, key);
    return key;
  }

  function memberSignature(conversation: ConversationDto) {
    return conversation.members.map((member) => member.id).sort().join(":");
  }

  async function rotateConversationKey(conversation: ConversationDto) {
    const keys = await request<{ id: string; publicKey: string | null }[]>(`/users/keys?ids=${encodeURIComponent(conversation.members.map((member) => member.id).join(","))}`);
    if (keys.length !== conversation.members.length || keys.some((item) => !item.publicKey)) throw new Error("部分成员尚未启用端到端加密，请让对方先登录 0.2.0 或更高版本客户端");
    const raw = webcrypto.getRandomValues(new Uint8Array(32));
    const aesKey = await webcrypto.subtle.importKey("raw", exactBuffer(raw), "AES-GCM", false, ["encrypt", "decrypt"]);
    const envelopes = await Promise.all(keys.map(async (item) => ({
      userId: item.id,
      encryptedKey: toBase64(new Uint8Array(await webcrypto.subtle.encrypt({ name: "RSA-OAEP" }, await importPublicKey(item.publicKey!), exactBuffer(raw)))),
    })));
    let created: KeyEnvelope;
    try {
      created = await request<KeyEnvelope>(`/conversations/${conversation.id}/keys`, { method: "POST", body: JSON.stringify({ envelopes }) });
    } catch {
      const latest = await request<KeyEnvelope | null>(`/conversations/${conversation.id}/keys/latest`);
      if (!latest?.encryptedKey || latest.memberIds.join(":") !== memberSignature(conversation)) throw new Error("会话密钥创建失败，请重试");
      return { key: await unwrapKey(conversation.id, latest), version: latest.version };
    }
    keyCache.set(`${conversation.id}:${created.version}`, aesKey);
    return { key: aesKey, version: created.version };
  }

  async function conversationKey(conversation: ConversationDto, version?: number) {
    if (version) {
      const cached = keyCache.get(`${conversation.id}:${version}`);
      if (cached) return { key: cached, version };
      return { key: await unwrapKey(conversation.id, await request<KeyEnvelope>(`/conversations/${conversation.id}/keys/${version}`)), version };
    }
    const latest = await request<KeyEnvelope | null>(`/conversations/${conversation.id}/keys/latest`);
    if (latest && latest.encryptedKey && latest.memberIds.join(":") === memberSignature(conversation)) {
      const cached = keyCache.get(`${conversation.id}:${latest.version}`);
      if (cached) return { key: cached, version: latest.version };
      try { return { key: await unwrapKey(conversation.id, latest), version: latest.version }; } catch { /* 本机身份密钥更换后需要重新分发会话密钥 */ }
    }
    return rotateConversationKey(conversation);
  }

  async function encryptContent(conversation: ConversationDto, content: EncryptedMessageContent, keyVersion?: number) {
    const { key, version } = await conversationKey(conversation, keyVersion);
    const nonce = webcrypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await webcrypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, encoder.encode(JSON.stringify(content)));
    return { ciphertext: toBase64(new Uint8Array(ciphertext)), nonce: toBase64(nonce), keyVersion: version };
  }

  async function decryptMessage(message: MessageDto, conversation: ConversationDto): Promise<DecryptedMessage> {
    if (!message.ciphertext || !message.nonce || !message.keyVersion) return { message, content: null };
    try {
      const { key } = await conversationKey(conversation, message.keyVersion);
      const plaintext = await webcrypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64(message.nonce) }, key, exactBuffer(fromBase64(message.ciphertext)));
      const content = JSON.parse(decoder.decode(plaintext)) as EncryptedMessageContent;
      return { message: { ...message, text: content.text ?? null, attachments: (content.attachments ?? []).map((item) => ({ ...item, encrypted: true })) }, content };
    } catch {
      return { message: { ...message, text: "[无法解密的消息]", attachments: [] }, content: null };
    }
  }

  async function decryptAttachment(attachment: EncryptedAttachmentMetadata, conversation: ConversationDto, keyVersion: number, variant: "original" | "thumbnail" = "original") {
    const encrypted = await fetchBytes(`/attachments/${attachment.id}/${variant}`);
    const { key } = await conversationKey(conversation, keyVersion);
    const nonce = variant === "thumbnail" ? attachment.thumbnailNonce : attachment.originalNonce;
    const plaintext = await webcrypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64(nonce) }, key, exactBuffer(encrypted));
    return new Uint8Array(plaintext);
  }

  return { conversationKey, encryptContent, decryptMessage, decryptAttachment, publicKey: identity.publicKey };
}
