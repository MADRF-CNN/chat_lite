import { useEffect, useRef, useState } from "react";
import type { ConversationDto, EncryptedAttachmentMetadata, MessageDto, UserSummary } from "@chat-lite/shared";
import { ImagePlus, LogOut, MessageCircle, Plus, Search, Send, Settings, ShieldCheck, Users } from "lucide-react";
import { io, Socket } from "socket.io-client";
import { api, assertSecureTransport, authenticate, authenticatedImage, desktopBridge, getAccessToken, refreshSession, setAccessToken, SOCKET_URL } from "./api";
import { conversationTitle } from "./conversation";
import { decryptImage, decryptMessage, encryptContent, encryptImage, ensureIdentity } from "./crypto";

type AuthMode = "login" | "register";
type SearchMode = "direct" | "group" | "add-member";

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function terminalTime(value: string) {
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function Login({ onAuthenticated }: { onAuthenticated: (user: UserSummary) => void }) {
  const [mode, setMode] = useState<AuthMode>("login");
  const [form, setForm] = useState({ username: "", displayName: "", password: "", inviteCode: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try { const result = await authenticate(mode, form); onAuthenticated(result.user); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "登录失败"); }
    finally { setBusy(false); }
  }
  return <main className="auth-page">
    <section className="auth-card terminal-window">
      <div className="terminal-titlebar"><span className="terminal-lights"><i /><i /><i /></span><span>chat-lite — secure shell</span></div>
      <div className="auth-content">
      <div className="brand-mark">&gt;_</div>
      <h1>CHAT_LITE</h1><p className="muted">E2EE terminal messenger · macOS</p>
      <p className="boot-line"><span>[ok]</span> secure transport initialized</p>
      <div className="auth-tabs"><button type="button" className={mode === "login" ? "active" : ""} onClick={() => setMode("login")}>登录</button><button type="button" className={mode === "register" ? "active" : ""} onClick={() => setMode("register")}>注册</button></div>
      <form onSubmit={submit}>
        <label><span>username:</span><input autoFocus value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} minLength={3} required /></label>
        {mode === "register" && <label><span>display_name:</span><input value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} required /></label>}
        <label><span>password:</span><input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} minLength={8} required /></label>
        {mode === "register" && <label><span>invite_code:</span><input value={form.inviteCode} onChange={(e) => setForm({ ...form, inviteCode: e.target.value })} required /></label>}
        {error && <p className="error">{error}</p>}
        <button className="primary wide" disabled={busy}>{busy ? "[ 连接中... ]" : mode === "login" ? "[ 登录 ]" : "[ 创建账号 ]"}</button>
      </form>
      </div>
    </section>
  </main>;
}

function ChatImage({ attachment, conversation, keyVersion }: { attachment: MessageDto["attachments"][number]; conversation: ConversationDto; keyVersion?: number | null }) {
  const [src, setSrc] = useState<string>(); const [fullSrc, setFullSrc] = useState<string>();
  const encryptedAttachment = attachment as EncryptedAttachmentMetadata & typeof attachment;
  async function load(variant: "thumbnail" | "original") {
    return attachment.encrypted && keyVersion
      ? decryptImage(encryptedAttachment, conversation, variant, keyVersion)
      : authenticatedImage(attachment.id, variant);
  }
  useEffect(() => { let url: string; void load("thumbnail").then((blob) => { url = URL.createObjectURL(blob); setSrc(url); }); return () => { if (url) URL.revokeObjectURL(url); }; }, [attachment.id, keyVersion]);
  async function open() { const blob = await load("original"); setFullSrc(URL.createObjectURL(blob)); }
  async function save(event: React.MouseEvent) { event.stopPropagation(); const blob = await load("original"); await desktopBridge.saveFile(attachment.originalName, new Uint8Array(await blob.arrayBuffer())); }
  return <><div className="chat-image"><div className="image-meta"><span>┌─ image: {attachment.originalName}</span><span>{attachment.width}×{attachment.height} · {formatBytes(attachment.size)}</span></div><div className="image-frame" onClick={() => void open()}>{src ? <img src={src} alt={attachment.originalName} /> : <div className="image-loading">[ decrypting image... ]</div>}</div><div className="image-actions"><span>└─ encrypted attachment</span><button onClick={(event) => void save(event)}>[保存]</button></div></div>{fullSrc && <div className="lightbox" onClick={() => { URL.revokeObjectURL(fullSrc); setFullSrc(undefined); }}><div className="lightbox-title">{attachment.originalName}</div><img src={fullSrc} alt={attachment.originalName} /><button>[关闭]</button></div>}</>;
}

function SearchDialog({ mode, conversation, onClose, onDone }: { mode: SearchMode; conversation?: ConversationDto; onClose: () => void; onDone: (id?: string) => void }) {
  const [query, setQuery] = useState(""); const [users, setUsers] = useState<UserSummary[]>([]); const [selected, setSelected] = useState<UserSummary[]>([]); const [groupName, setGroupName] = useState("");
  useEffect(() => { const timer = setTimeout(() => { if (query.length >= 2) void api<UserSummary[]>(`/users/search?q=${encodeURIComponent(query)}`).then(setUsers); else setUsers([]); }, 250); return () => clearTimeout(timer); }, [query]);
  async function choose(user: UserSummary) {
    if (mode === "direct") { const result = await api<{ id: string }>("/conversations/direct", { method: "POST", body: JSON.stringify({ userId: user.id }) }); onDone(result.id); return; }
    if (mode === "add-member" && conversation) { await api(`/conversations/${conversation.id}/members`, { method: "POST", body: JSON.stringify({ userId: user.id }) }); onDone(conversation.id); return; }
    setSelected((current) => current.some((item) => item.id === user.id) ? current.filter((item) => item.id !== user.id) : [...current, user]);
  }
  async function createGroup() { if (!groupName.trim() || !selected.length) return; const result = await api<{ id: string }>("/conversations/group", { method: "POST", body: JSON.stringify({ name: groupName, memberIds: selected.map((user) => user.id) }) }); onDone(result.id); }
  return <div className="modal-backdrop" onMouseDown={onClose}><section className="modal terminal-window" onMouseDown={(e) => e.stopPropagation()}>
    <header><h2>$ {mode === "direct" ? "new-direct-chat" : mode === "group" ? "create-group" : "add-member"}</h2><button className="icon" onClick={onClose}>[×]</button></header>
    {mode === "group" && <input placeholder="群聊名称" value={groupName} onChange={(e) => setGroupName(e.target.value)} />}
    {selected.length > 0 && <div className="selected-users">{selected.map((user) => <span key={user.id}>{user.displayName}</span>)}</div>}
    <div className="search-box"><Search size={17} /><input autoFocus placeholder="搜索用户名或显示名称" value={query} onChange={(e) => setQuery(e.target.value)} /></div>
    <div className="user-results">{users.filter((user) => !conversation?.members.some((member) => member.id === user.id)).map((user) => <button key={user.id} onClick={() => void choose(user)}><span className="avatar small">{user.displayName[0]}</span><span><strong>{user.displayName}</strong><small>@{user.username}</small></span>{mode === "group" && <span className="check">{selected.some((item) => item.id === user.id) ? "✓" : "+"}</span>}</button>)}</div>
    {mode === "group" && <button className="primary wide" disabled={!groupName.trim() || !selected.length} onClick={() => void createGroup()}>[ 创建群聊 ]</button>}
  </section></div>;
}

function GroupSettings({ conversation, me, onClose, onChanged }: { conversation: ConversationDto; me: UserSummary; onClose: () => void; onChanged: () => void }) {
  const [adding, setAdding] = useState(false); const [name, setName] = useState(conversation.name ?? ""); const isOwner = conversation.ownerId === me.id;
  async function rename() { await api(`/conversations/${conversation.id}`, { method: "PATCH", body: JSON.stringify({ name }) }); onChanged(); }
  async function remove(userId: string) { await api(`/conversations/${conversation.id}/members/${userId}`, { method: "DELETE" }); onChanged(); }
  async function leave() { await api(`/conversations/${conversation.id}/leave`, { method: "POST" }); onChanged(); onClose(); }
  return <div className="modal-backdrop" onMouseDown={onClose}><section className="modal terminal-window" onMouseDown={(e) => e.stopPropagation()}><header><h2>$ group-config</h2><button className="icon" onClick={onClose}>[×]</button></header>
    {isOwner && <div className="rename-row"><input value={name} onChange={(e) => setName(e.target.value)} /><button onClick={() => void rename()}>[保存名称]</button></div>}
    <div className="member-heading"><strong>members/{conversation.members.length}</strong>{isOwner && <button onClick={() => setAdding(true)}>[添加成员]</button>}</div>
    <div className="member-list">{conversation.members.map((member) => <div key={member.id}><span className="avatar small">{member.displayName[0]}</span><span>{member.displayName}{member.id === conversation.ownerId && <small> [owner]</small>}</span>{isOwner && member.id !== me.id && <button className="danger-text" onClick={() => void remove(member.id)}>[移除]</button>}</div>)}</div>
    {!isOwner && <button className="danger wide" onClick={() => void leave()}>[退出群聊]</button>}
    {adding && <SearchDialog mode="add-member" conversation={conversation} onClose={() => setAdding(false)} onDone={() => { setAdding(false); onChanged(); }} />}
  </section></div>;
}

function Workspace({ me, onLogout }: { me: UserSummary; onLogout: () => void }) {
  const [conversations, setConversations] = useState<ConversationDto[]>([]); const [selectedId, setSelectedId] = useState<string>(); const [messages, setMessages] = useState<MessageDto[]>([]); const [nextCursor, setNextCursor] = useState<string | null>(null); const [text, setText] = useState(""); const [dialog, setDialog] = useState<SearchMode>(); const [settings, setSettings] = useState(false); const [error, setError] = useState(""); const [uploading, setUploading] = useState(false); const socket = useRef<Socket | undefined>(undefined); const selectedIdRef = useRef<string | undefined>(undefined); const conversationsRef = useRef<ConversationDto[]>([]); const fileInput = useRef<HTMLInputElement>(null); const bottom = useRef<HTMLDivElement>(null);
  const selected = conversations.find((item) => item.id === selectedId);
  async function loadConversations(select?: string) { const raw = await api<ConversationDto[]>("/conversations"); const items = await Promise.all(raw.map(async (conversation) => ({ ...conversation, lastMessage: conversation.lastMessage ? await decryptMessage(conversation.lastMessage, conversation) : null }))); conversationsRef.current = items; setConversations(items); setSelectedId((current) => select ?? current ?? items[0]?.id); return items; }
  useEffect(() => { selectedIdRef.current = selectedId; }, [selectedId]);
  useEffect(() => { let disposed = false; let connection: Socket | undefined; void (async () => { try { await ensureIdentity(me); await loadConversations(); assertSecureTransport(SOCKET_URL); if (disposed) return; connection = io(SOCKET_URL, { auth: { token: getAccessToken() }, transports: ["websocket"] }); socket.current = connection; connection.on("message:new", (incoming: MessageDto) => { void (async () => { const conversation = conversationsRef.current.find((item) => item.id === incoming.conversationId); const message = conversation ? await decryptMessage(incoming, conversation) : incoming; if (message.conversationId === selectedIdRef.current) { setMessages((items) => items.some((item) => item.id === message.id) ? items : [...items, message]); void api(`/conversations/${message.conversationId}/read`, { method: "POST", body: JSON.stringify({ messageId: message.id }) }); } await loadConversations(); })(); }); connection.on("conversation:updated", () => void loadConversations()); connection.on("membership:changed", () => void loadConversations()); } catch (cause) { setError(cause instanceof Error ? cause.message : "端到端加密初始化失败"); } })(); return () => { disposed = true; connection?.disconnect(); }; }, []);
  useEffect(() => { if (!selectedId || !selected) return; socket.current?.emit("conversation:join", selectedId); void api<{ items: MessageDto[]; nextCursor: string | null }>(`/conversations/${selectedId}/messages`).then(async ({ items, nextCursor: cursor }) => { const decrypted = await Promise.all(items.map((message) => decryptMessage(message, selected))); setMessages(decrypted); setNextCursor(cursor); const last = decrypted.at(-1); if (last) void api(`/conversations/${selectedId}/read`, { method: "POST", body: JSON.stringify({ messageId: last.id }) }).then(() => loadConversations()); }).catch((cause) => setError(cause instanceof Error ? cause.message : "消息加载失败")); }, [selectedId]);
  async function loadOlder() { if (!selectedId || !selected || !nextCursor) return; const page = await api<{ items: MessageDto[]; nextCursor: string | null }>(`/conversations/${selectedId}/messages?cursor=${encodeURIComponent(nextCursor)}`); const decrypted = await Promise.all(page.items.map((message) => decryptMessage(message, selected))); setMessages((items) => [...decrypted, ...items]); setNextCursor(page.nextCursor); }
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);
  async function send(attachments: EncryptedAttachmentMetadata[] = [], keyVersion?: number) { if (!selectedId || !selected || (!text.trim() && !attachments.length)) return; const outgoing = text; if (outgoing.length > 4000) { setError("消息不能超过 4000 个字符"); return; } setText(""); try { const encrypted = await encryptContent(selected, { text: outgoing || undefined, attachments }, keyVersion); const raw = await api<MessageDto>(`/conversations/${selectedId}/messages`, { method: "POST", body: JSON.stringify({ clientId: crypto.randomUUID(), ...encrypted, attachmentIds: attachments.map((item) => item.id) }) }); const message = await decryptMessage(raw, selected); setMessages((items) => items.some((item) => item.id === message.id) ? items : [...items, message]); } catch (cause) { setText(outgoing); setError(cause instanceof Error ? cause.message : "发送失败"); } }
  async function upload(file?: File) { if (!file || !selected) return; setUploading(true); try { const encrypted = await encryptImage(file, selected); await send([encrypted.metadata], encrypted.keyVersion); } catch (cause) { setError(cause instanceof Error ? cause.message : "图片上传失败"); } finally { setUploading(false); if (fileInput.current) fileInput.current.value = ""; } }
  async function logout() { const refreshToken = await desktopBridge.loadRefreshToken(); if (refreshToken) await api("/auth/logout", { method: "POST", body: JSON.stringify({ refreshToken }) }).catch(() => undefined); setAccessToken(null); await desktopBridge.saveRefreshToken(null); localStorage.removeItem("currentUser"); onLogout(); }
  return <main className="workspace">
    <nav className="rail">
      <div className="rail-logo" title="Chat Lite">&gt;_</div>
      <div className="rail-avatar" title={`${me.displayName} (@${me.username})`}>{me.displayName[0]}</div>
      <button className="active" title="聊天"><MessageCircle size={19} /><small>CHAT</small></button>
      <button title="通讯录" onClick={() => setDialog("direct")}><Users size={19} /><small>USER</small></button>
      <span className="rail-spacer" />
      <div className="secure" title="消息和图片已端到端加密"><ShieldCheck size={18} /><small>E2EE</small></div>
      <button title="退出登录" onClick={() => void logout()}><LogOut size={18} /><small>EXIT</small></button>
    </nav>
    <aside className="sidebar">
      <div className="panel-title"><span>~/conversations</span><span className="online-dot">● ONLINE</span></div>
      <div className="sidebar-top"><div className="sidebar-search"><Search size={15} /><span>filter sessions...</span></div><button className="square-action" title="发起聊天" onClick={() => setDialog("direct")}><Plus size={16} /></button></div>
      <div className="actions"><button onClick={() => setDialog("direct")}>[+ 私聊]</button><button onClick={() => setDialog("group")}>[+ 群聊]</button></div>
      <div className="conversation-list">{conversations.map((conversation) => <button key={conversation.id} className={conversation.id === selectedId ? "selected" : ""} onClick={() => setSelectedId(conversation.id)}><span className="tree-prefix">{conversation.id === selectedId ? ">" : "├"}</span><span className="avatar">{conversation.type === "GROUP" ? <Users size={16} /> : conversationTitle(conversation, me)[0]}</span><span className="conversation-copy"><strong>{conversationTitle(conversation, me)}</strong><small>{conversation.lastMessage?.text ?? (conversation.lastMessage?.attachments.length ? "[image]" : "-- no messages --")}</small></span>{conversation.unreadCount > 0 && <em>{conversation.unreadCount}</em>}</button>)}</div>
      <div className="sidebar-status">{conversations.length} session(s) · encrypted</div>
    </aside>
    <section className="chat-panel">{selected ? <>
      <header className="chat-header"><div><span className="path">chat-lite://{selected.type.toLowerCase()}/</span><h2>{conversationTitle(selected, me)}</h2><small>{selected.type === "GROUP" ? `${selected.members.length} members` : "direct session"} · AES-256-GCM</small></div>{selected.type === "GROUP" && <button className="icon" onClick={() => setSettings(true)}><Settings size={17} /> [config]</button>}</header>
      <div className="messages"><div className="session-banner"><span>Chat Lite secure session</span><span>connection: encrypted · history: {messages.length} entries</span></div>{nextCursor && <button className="load-older" onClick={() => void loadOlder()}>[ load older entries ]</button>}{messages.map((message) => { const mine = message.sender.id === me.id; return <article key={message.id} className={`message ${mine ? "mine" : ""}`}><div className="log-prefix"><time>[{terminalTime(message.createdAt)}]</time><strong>{mine ? "you" : message.sender.username}@{mine ? "local" : "remote"}</strong><span>&gt;</span></div><div className="log-content">{message.text && <p>{message.text}</p>}{message.attachments.map((attachment) => <ChatImage key={attachment.id} attachment={attachment} conversation={selected} keyVersion={message.keyVersion} />)}</div></article>; })}<div ref={bottom} /></div>
      <footer className="composer"><input ref={fileInput} hidden type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={(e) => void upload(e.target.files?.[0])} /><div className="prompt-line"><span className="prompt-user">{me.username}@chat-lite</span><span>:</span><span className="prompt-path">~$</span><textarea aria-label="消息内容" placeholder={uploading ? "encrypting image..." : "输入消息，Enter 发送，Shift+Enter 换行"} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }} /></div><div className="composer-actions"><button className="icon" disabled={uploading} onClick={() => fileInput.current?.click()}><ImagePlus size={16} /> [image]</button><span>{text.length}/4000</span><button className="send" disabled={!text.trim() || uploading} onClick={() => void send()}><Send size={15} /> [发送]</button></div></footer>
    </> : <div className="empty-state"><div className="ascii-logo">&gt;_ CHAT_LITE</div><p>&gt; 选择一个会话，或创建新的加密连接。</p><small>[ waiting for input ]</small></div>}</section>
    {error && <div className="toast" onClick={() => setError("")}><span>[error]</span> {error} <button>[dismiss]</button></div>}
    {dialog && <SearchDialog mode={dialog} onClose={() => setDialog(undefined)} onDone={(id) => { setDialog(undefined); void loadConversations(id); }} />}
    {settings && selected && <GroupSettings conversation={selected} me={me} onClose={() => setSettings(false)} onChanged={() => void loadConversations()} />}
  </main>;
}

export function App() {
  const [me, setMe] = useState<UserSummary | null>(() => { try { return JSON.parse(localStorage.getItem("currentUser") ?? "null"); } catch { return null; } });
  const [booting, setBooting] = useState(true);
  useEffect(() => { void refreshSession().then((ok) => { if (!ok) setMe(null); setBooting(false); }); }, []);
  if (booting) return <main className="splash"><div className="brand-mark">&gt;_</div><span>booting chat_lite...</span><small>[ initializing secure session ]</small></main>;
  return me ? <Workspace me={me} onLogout={() => setMe(null)} /> : <Login onAuthenticated={setMe} />;
}
