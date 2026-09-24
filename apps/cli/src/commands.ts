import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import type { MessageDto } from "@chat-lite/shared";
import type { DecryptedMessage } from "./crypto";
import { Client, conversationLabel, defaultApiUrl } from "./client";
import { conversationLine, decryptedLine, formatSize, previewOf, shortId } from "./format";
import { flagBool, flagNumber, flagString, parseFlags, serverFlag, type Values } from "./args";
import { fail, info, warn } from "./log";
import { ask, askHidden } from "./prompt";
import { configDir, clearConfig, readConfig, readSecrets, rememberCa, writeSecrets } from "./store";
import { watch } from "./watch";
import { runRepl } from "./repl";

export type Command = { usage: string; summary: string; run: (args: string[]) => Promise<void> };

const flags = {
  ...serverFlag,
  username: { type: "string" as const, short: "u" },
  password: { type: "string" as const, short: "p" },
  "display-name": { type: "string" as const, short: "d" },
  invite: { type: "string" as const, short: "i" },
};

function serverOf(values: Values) {
  return flagString(values, "server") ?? defaultApiUrl();
}

async function restore(values: Values) {
  return Client.restore(flagString(values, "server"));
}

async function readPassword(flag: string | undefined) {
  if (flag) return flag;
  const password = await askHidden("密码：");
  if (!password) fail("密码不能为空");
  return password;
}

function printConversation(conversation: { id: string }, label: string) {
  info(`会话 ID：${conversation.id}`);
  info(`会话：${label}`);
}

function announceCa() {
  const caPath = rememberCa();
  if (caPath) info(`已记住根证书：${caPath}（后续命令自动使用）`);
}

const login: Command = {
  usage: "chat-lite login [--server <地址>] [--username <用户名>] [--password <密码>]",
  summary: "登录已有账号，密码缺省时交互输入",
  async run(args) {
    const { values } = parseFlags(args, flags);
    const apiUrl = serverOf(values);
    const username = flagString(values, "username") ?? (await ask("用户名："));
    if (!username) fail("用户名不能为空");
    const password = await readPassword(flagString(values, "password"));
    const client = await Client.authenticate(apiUrl, "login", { username, password });
    info(`已登录：${client.user.displayName} (@${client.user.username})`);
    info(`配置目录：${configDir()}`);
    announceCa();
  },
};

const register: Command = {
  usage: "chat-lite register [--server <地址>] --invite <邀请码> [--username <用户名>] [--display-name <显示名>] [--password <密码>]",
  summary: "使用邀请码注册新账号",
  async run(args) {
    const { values } = parseFlags(args, flags);
    const apiUrl = serverOf(values);
    const inviteCode = flagString(values, "invite") ?? (await ask("邀请码："));
    if (!inviteCode) fail("邀请码不能为空");
    const username = flagString(values, "username") ?? (await ask("用户名（3-32 位）："));
    if (!username) fail("用户名不能为空");
    const displayName = flagString(values, "display-name") ?? (await ask("显示名称："));
    if (!displayName) fail("显示名称不能为空");
    let password = flagString(values, "password");
    if (!password) {
      password = await askHidden("密码（8-128 位）：");
      if (password !== await askHidden("确认密码：")) fail("两次输入的密码不一致");
    }
    const client = await Client.authenticate(apiUrl, "register", { username, displayName, password, inviteCode });
    info(`已注册并登录：${client.user.displayName} (@${client.user.username})`);
    info(`配置目录：${configDir()}`);
    announceCa();
  },
};

const logout: Command = {
  usage: "chat-lite logout [--server <地址>] [--forget-identity]",
  summary: "退出登录；默认保留本机身份密钥，--forget-identity 会一并删除",
  async run(args) {
    const { values } = parseFlags(args, { ...serverFlag, "forget-identity": { type: "boolean" } });
    const client = await restore(values).catch(() => null);
    if (client) await client.logout();
    const secrets = readSecrets();
    delete secrets.refreshToken;
    if (flagBool(values, "forget-identity")) {
      const user = readConfig()?.user;
      if (user) delete secrets.identities[user.id];
      info("已删除本机身份密钥，下次登录将生成新的身份密钥");
    }
    writeSecrets(secrets);
    clearConfig();
    info("已退出登录");
  },
};

const whoami: Command = {
  usage: "chat-lite whoami [--server <地址>]",
  summary: "显示当前登录账号与本机身份密钥指纹",
  async run(args) {
    const { values } = parseFlags(args, serverFlag);
    const client = await restore(values);
    const identity = readSecrets().identities[client.user.id];
    const fingerprint = identity
      ? createHash("sha256").update(identity.publicKey).digest("hex").slice(0, 16).replace(/(.{4})(?=.)/g, "$1 ")
      : "缺失";
    info(`账号：${client.user.displayName} (@${client.user.username})`);
    info(`用户 ID：${client.user.id}`);
    info(`身份密钥指纹：${fingerprint}`);
    info(`配置目录：${configDir()}`);
  },
};

const list: Command = {
  usage: "chat-lite list [--server <地址>]",
  summary: "列出全部会话、未读数与最后一条消息",
  async run(args) {
    const { values } = parseFlags(args, serverFlag);
    const client = await restore(values);
    const conversations = await client.listConversations();
    if (!conversations.length) {
      info("还没有会话。用 chat-lite open <用户名> 发起私聊，或 chat-lite group <群名> <用户...> 创建群聊");
      return;
    }
    for (const conversation of conversations) {
      const decrypted = conversation.lastMessage ? await client.e2ee.decryptMessage(conversation.lastMessage, conversation) : null;
      info(conversationLine(conversation, client.user, decrypted ? previewOf(decrypted) : null));
    }
  },
};

const search: Command = {
  usage: "chat-lite search <关键词> [--server <地址>]",
  summary: "按用户名或显示名搜索用户",
  async run(args) {
    const { values, positionals } = parseFlags(args, serverFlag);
    const query = positionals.join(" ").trim();
    if (query.length < 2) fail("搜索关键词至少 2 个字符");
    const client = await restore(values);
    const users = await client.searchUsers(query);
    if (!users.length) {
      info("没有匹配的用户");
      return;
    }
    for (const user of users) info(`${user.username}  ${user.displayName}  [${shortId(user.id)}]`);
  },
};

const open: Command = {
  usage: "chat-lite open <用户名> [--server <地址>]",
  summary: "打开与某用户的私聊（不存在时创建）",
  async run(args) {
    const { values, positionals } = parseFlags(args, serverFlag);
    const name = positionals[0];
    if (!name) fail("用法：chat-lite open <用户名>");
    const client = await restore(values);
    const user = await client.findUser(name);
    const created = await client.createDirect(user.id);
    info(`已打开与 ${user.displayName} (@${user.username}) 的私聊`);
    printConversation(created, user.displayName);
  },
};

const group: Command = {
  usage: "chat-lite group <群名> <用户名...> [--server <地址>]",
  summary: "创建群聊并邀请成员",
  async run(args) {
    const { values, positionals } = parseFlags(args, serverFlag);
    const [name, ...names] = positionals;
    if (!name || !names.length) fail("用法：chat-lite group <群名> <用户名...>");
    const client = await restore(values);
    const members = await Promise.all(names.map((item) => client.findUser(item)));
    const created = await client.createGroup(name, members.map((member) => member.id));
    info(`已创建群聊“${name}”，成员：${members.map((member) => member.displayName).join("、")}`);
    printConversation(created, name);
  },
};

const send: Command = {
  usage: "chat-lite send <会话> <文本> [--server <地址>]",
  summary: "发送端到端加密消息，会话支持 ID 前缀、用户名或群名",
  async run(args) {
    const { values, positionals } = parseFlags(args, serverFlag);
    const [target, ...words] = positionals;
    const text = words.join(" ").trim();
    if (!target || !text) fail("用法：chat-lite send <会话> <文本>");
    if (text.length > 4000) fail("消息不能超过 4000 个字符");
    const client = await restore(values);
    const conversation = await client.resolveConversation(target);
    const encrypted = await client.e2ee.encryptContent(conversation, { text, attachments: [] });
    await client.sendMessage(conversation.id, encrypted.ciphertext, encrypted.nonce, encrypted.keyVersion);
    info(`已发送 → ${conversationLabel(conversation, client.user)}`);
  },
};

const history: Command = {
  usage: "chat-lite history <会话> [--limit <条数>] [--all] [--ids] [--read] [--server <地址>]",
  summary: "查看并解密历史消息",
  async run(args) {
    const { values, positionals } = parseFlags(args, {
      ...serverFlag,
      limit: { type: "string", short: "n" },
      all: { type: "boolean" },
      ids: { type: "boolean" },
      read: { type: "boolean" },
    });
    const target = positionals[0];
    if (!target) fail("用法：chat-lite history <会话> [--limit <条数>] [--all]");
    const limit = flagNumber(values, "limit") ?? 30;
    const all = flagBool(values, "all");
    const client = await restore(values);
    const conversation = await client.resolveConversation(target);
    const messages: MessageDto[] = [];
    let cursor: string | undefined;
    do {
      const page = await client.messages(conversation.id, cursor, all ? 100 : limit);
      messages.unshift(...page.items);
      cursor = page.nextCursor ?? undefined;
    } while (all && cursor && messages.length < 2000);
    if (all && cursor) warn("仅显示最近 2000 条消息");
    if (!messages.length) {
      info("暂无消息");
      return;
    }
    for (const message of messages) {
      info(decryptedLine(await client.e2ee.decryptMessage(message, conversation), client.user, flagBool(values, "ids")));
    }
    if (flagBool(values, "read")) {
      const last = messages[messages.length - 1];
      if (last) await client.markRead(conversation.id, last.id);
      info("已标记为已读");
    }
  },
};

const read: Command = {
  usage: "chat-lite read <会话> [--server <地址>]",
  summary: "将会话标记为已读",
  async run(args) {
    const { values, positionals } = parseFlags(args, serverFlag);
    const target = positionals[0];
    if (!target) fail("用法：chat-lite read <会话>");
    const client = await restore(values);
    const conversation = await client.resolveConversation(target);
    const page = await client.messages(conversation.id, undefined, 1);
    const last = page.items[page.items.length - 1];
    if (!last) {
      info("暂无消息");
      return;
    }
    await client.markRead(conversation.id, last.id);
    info(`已将 ${conversationLabel(conversation, client.user)} 标记为已读`);
  },
};

function uniquePath(dir: string, name: string) {
  const safe = basename(name).replace(/[/\\]/g, "_") || "attachment";
  const extension = extname(safe);
  const stem = safe.slice(0, safe.length - extension.length);
  let candidate = join(dir, safe);
  for (let index = 1; existsSync(candidate); index += 1) candidate = join(dir, `${stem}-${index}${extension}`);
  return candidate;
}

const download: Command = {
  usage: "chat-lite download <会话> <消息ID> [--out <目录>] [--server <地址>]",
  summary: "下载并解密消息中的图片（消息 ID 可用 history --ids 查看）",
  async run(args) {
    const { values, positionals } = parseFlags(args, { ...serverFlag, out: { type: "string", short: "o" } });
    const [target, messageId] = positionals;
    if (!target || !messageId) fail("用法：chat-lite download <会话> <消息ID> [--out <目录>]");
    const client = await restore(values);
    const conversation = await client.resolveConversation(target);
    const dir = flagString(values, "out") ?? ".";
    mkdirSync(dir, { recursive: true });
    let found: DecryptedMessage | null = null;
    let cursor: string | undefined;
    let scanned = 0;
    while (!found && scanned < 2000) {
      const page = await client.messages(conversation.id, cursor, 100);
      scanned += page.items.length;
      const message = page.items.find((item) => item.id === messageId || item.id.startsWith(messageId));
      if (message) found = await client.e2ee.decryptMessage(message, conversation);
      cursor = page.nextCursor ?? undefined;
      if (!cursor) break;
    }
    if (!found) fail("在最近的 2000 条消息中没有找到该消息");
    const attachments = found.content?.attachments ?? [];
    if (!attachments.length) fail("该消息没有图片附件");
    if (!found.message.keyVersion) fail("该消息缺少密钥版本，无法解密图片");
    for (const attachment of attachments) {
      const bytes = await client.e2ee.decryptAttachment(attachment, conversation, found.message.keyVersion);
      const path = uniquePath(dir, attachment.originalName);
      writeFileSync(path, bytes);
      info(`已保存：${path}（${formatSize(bytes.length)}）`);
    }
  },
};

const watchCommand: Command = {
  usage: "chat-lite watch [--read] [--server <地址>]",
  summary: "保持连接并实时打印新消息，--read 同时标记已读",
  async run(args) {
    const { values } = parseFlags(args, { ...serverFlag, read: { type: "boolean" } });
    const client = await restore(values);
    await watch(client, flagBool(values, "read"));
  },
};

const chatCommand: Command = {
  usage: "chat-lite [chat] [--mask|-m] [--server <地址>]",
  summary: "进入交互式即时聊天终端 (支持 / 指令与实时收发，--mask 可直接伪装启动)",
  async run(args) {
    const { values } = parseFlags(args, {
      ...serverFlag,
      mask: { type: "boolean", short: "m" },
    });
    const client = await restore(values);
    await runRepl(client, { initialMasked: Boolean(values.mask) });
  },
};

export const commands: Record<string, Command> = {
  chat: chatCommand,
  repl: chatCommand,
  login,
  register,
  logout,
  whoami,
  list,
  search,
  open,
  group,
  send,
  history,
  read,
  download,
  watch: watchCommand,
};
