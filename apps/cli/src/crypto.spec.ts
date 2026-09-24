import assert from "node:assert/strict";
import test from "node:test";
import type { ConversationDto, MessageDto } from "@chat-lite/shared";
import { createE2ee, generateIdentity, type Identity } from "./crypto";

type FakeEnvelope = { userId: string; encryptedKey: string };
type FakeKey = { version: number; envelopes: FakeEnvelope[] };

class FakeServer {
  identities = new Map<string, Identity>();
  conversations = new Map<string, { members: string[]; keys: FakeKey[] }>();

  async createUser(id: string) {
    const identity = await generateIdentity();
    this.identities.set(id, identity);
    return identity;
  }

  createConversation(id: string, members: string[]) {
    this.conversations.set(id, { members, keys: [] });
  }

  setMembers(id: string, members: string[]) {
    const conversation = this.conversations.get(id);
    if (!conversation) throw new Error("conversation not found");
    conversation.members = members;
  }

  requestAs(userId: string) {
    return async <T>(path: string, init?: RequestInit): Promise<T> => {
      const [route, query] = path.split("?");
      if (route === "/users/keys") {
        const ids = decodeURIComponent((query ?? "").replace("ids=", "")).split(",").filter(Boolean);
        return ids.map((id) => ({ id, publicKey: this.identities.get(id)?.publicKey ?? null })) as T;
      }
      const match = route?.match(/^\/conversations\/([^/]+)\/keys(?:\/(latest|\d+))?$/);
      if (!match) throw new Error(`unexpected request ${path}`);
      const conversation = this.conversations.get(match[1]!);
      if (!conversation) throw new Error("conversation not found");
      const latest = conversation.keys.at(-1);
      if (init?.method === "POST") {
        const envelopes = (JSON.parse(String(init.body)) as { envelopes: FakeEnvelope[] }).envelopes;
        const version = (latest?.version ?? 0) + 1;
        conversation.keys.push({ version, envelopes });
        return { version, encryptedKey: this.envelopeFor(envelopes, userId), memberIds: sortedIds(envelopes) } as T;
      }
      const target = !match[2] || match[2] === "latest" ? latest : conversation.keys.find((item) => item.version === Number(match[2]));
      return {
        version: target?.version ?? 0,
        encryptedKey: this.envelopeFor(target?.envelopes ?? [], userId),
        memberIds: target ? sortedIds(target.envelopes) : [],
      } as T;
    };
  }

  private envelopeFor(envelopes: FakeEnvelope[], userId: string) {
    return envelopes.find((item) => item.userId === userId)?.encryptedKey ?? null;
  }
}

function sortedIds(envelopes: FakeEnvelope[]) {
  return envelopes.map((item) => item.userId).sort();
}

function conversationOf(members: string[]): ConversationDto {
  return {
    id: "conv1",
    type: "DIRECT",
    name: null,
    ownerId: null,
    members: members.map((id) => ({ id, username: id, displayName: id })),
    lastMessage: null,
    unreadCount: 0,
    updatedAt: new Date().toISOString(),
  };
}

function messageOf(conversationId: string, encrypted: { ciphertext: string; nonce: string; keyVersion: number }): MessageDto {
  return {
    id: "message1",
    clientId: "client-1",
    conversationId,
    text: null,
    ciphertext: encrypted.ciphertext,
    nonce: encrypted.nonce,
    keyVersion: encrypted.keyVersion,
    createdAt: new Date().toISOString(),
    sender: { id: "alice", username: "alice", displayName: "Alice" },
    attachments: [],
  };
}

async function setup() {
  const server = new FakeServer();
  const alice = await server.createUser("alice");
  const bob = await server.createUser("bob");
  server.createConversation("conv1", ["alice", "bob"]);
  const conversation = conversationOf(["alice", "bob"]);
  const fetchBytes = async () => { throw new Error("unused"); };
  return {
    server,
    conversation,
    alice: createE2ee(server.requestAs("alice"), fetchBytes, alice),
    bob: createE2ee(server.requestAs("bob"), fetchBytes, bob),
  };
}

test("会话密钥由发送方分发，接收方可用自己的身份密钥解密", async () => {
  const { conversation, alice, bob } = await setup();
  const encrypted = await alice.encryptContent(conversation, { text: "你好，Bob", attachments: [] });
  assert.equal(encrypted.keyVersion, 1);

  const decrypted = await bob.decryptMessage(messageOf(conversation.id, encrypted), conversation);
  assert.equal(decrypted.message.text, "你好，Bob");
  assert.deepEqual(decrypted.content, { text: "你好，Bob", attachments: [] });
});

test("同一会话重复加密复用同一版本密钥", async () => {
  const { conversation, alice, bob } = await setup();
  const first = await alice.encryptContent(conversation, { text: "第一条", attachments: [] });
  const second = await alice.encryptContent(conversation, { text: "第二条", attachments: [] });
  assert.equal(first.keyVersion, second.keyVersion);
  assert.notEqual(first.nonce, second.nonce);

  const decrypted = await bob.decryptMessage(messageOf(conversation.id, second), conversation);
  assert.equal(decrypted.message.text, "第二条");
});

test("密文被篡改时返回无法解密占位", async () => {
  const { conversation, alice, bob } = await setup();
  const encrypted = await alice.encryptContent(conversation, { text: "原始消息", attachments: [] });
  const tampered = { ...encrypted, ciphertext: `${encrypted.ciphertext.slice(0, -4)}AAAA` };
  const decrypted = await bob.decryptMessage(messageOf(conversation.id, tampered), conversation);
  assert.equal(decrypted.message.text, "[无法解密的消息]");
  assert.equal(decrypted.content, null);
});

test("成员变化后重新生成密钥版本", async () => {
  const { server, conversation, alice } = await setup();
  await alice.encryptContent(conversation, { text: "第一版", attachments: [] });
  await server.createUser("carol");
  server.setMembers("conv1", ["alice", "bob", "carol"]);
  const encrypted = await alice.encryptContent(conversationOf(["alice", "bob", "carol"]), { text: "第二版", attachments: [] });
  assert.equal(encrypted.keyVersion, 2);
});
