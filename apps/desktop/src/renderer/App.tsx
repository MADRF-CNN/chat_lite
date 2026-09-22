import { useEffect, useRef, useState } from "react";
import type { ConversationDto, EncryptedAttachmentMetadata, MessageDto, UserSummary } from "@chat-lite/shared";
import { ImagePlus, LogOut, MessageCircle, Plus, Search, Send, Settings, ShieldCheck, Users, X } from "lucide-react";
import { io, Socket } from "socket.io-client";
import { api, assertSecureTransport, authenticate, authenticatedImage, desktopBridge, getAccessToken, refreshSession, setAccessToken, SOCKET_URL } from "./api";
import { conversationTitle } from "./conversation";
import { decryptImage, decryptMessage, encryptContent, encryptImage, ensureIdentity } from "./crypto";

type AuthMode = "login" | "register";
type SearchMode = "direct" | "group" | "add-member";

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
    <section className="auth-card">
      <div className="brand-mark"><MessageCircle size={30} /></div>
      <h1>Chat Lite</h1><p className="muted">轻巧、私密的团队聊天</p>
      <div className="auth-tabs"><button className={mode === "login" ? "active" : ""} onClick={() => setMode("login")}>登录</button><button className={mode === "register" ? "active" : ""} onClick={() => setMode("register")}>注册</button></div>
      <form onSubmit={submit}>
        <label>用户名<input autoFocus value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} minLength={3} required /></label>
        {mode === "register" && <label>显示名称<input value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} required /></label>}
        <label>密码<input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} minLength={8} required /></label>
        {mode === "register" && <label>邀请码<input value={form.inviteCode} onChange={(e) => setForm({ ...form, inviteCode: e.target.value })} required /></label>}
        {error && <p className="error">{error}</p>}
        <button className="primary wide" disabled={busy}>{busy ? "请稍候…" : mode === "login" ? "登录" : "创建账号"}</button>
      </form>
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
  return <><div className="chat-image" onClick={() => void open()}>{src ? <img src={src} alt={attachment.originalName} /> : <div className="image-loading">加载中</div>}<button onClick={(event) => void save(event)}>保存</button></div>{fullSrc && <div className="lightbox" onClick={() => { URL.revokeObjectURL(fullSrc); setFullSrc(undefined); }}><img src={fullSrc} alt={attachment.originalName} /><button><X /></button></div>}</>;
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
  return <div className="modal-backdrop" onMouseDown={onClose}><section className="modal" onMouseDown={(e) => e.stopPropagation()}>
    <header><h2>{mode === "direct" ? "发起私聊" : mode === "group" ? "创建群聊" : "添加群成员"}</h2><button className="icon" onClick={onClose}><X /></button></header>
    {mode === "group" && <input placeholder="群聊名称" value={groupName} onChange={(e) => setGroupName(e.target.value)} />}
    {selected.length > 0 && <div className="selected-users">{selected.map((user) => <span key={user.id}>{user.displayName}</span>)}</div>}
    <div className="search-box"><Search size={17} /><input autoFocus placeholder="搜索用户名或显示名称" value={query} onChange={(e) => setQuery(e.target.value)} /></div>
    <div className="user-results">{users.filter((user) => !conversation?.members.some((member) => member.id === user.id)).map((user) => <button key={user.id} onClick={() => void choose(user)}><span className="avatar small">{user.displayName[0]}</span><span><strong>{user.displayName}</strong><small>@{user.username}</small></span>{mode === "group" && <span className="check">{selected.some((item) => item.id === user.id) ? "✓" : "+"}</span>}</button>)}</div>
    {mode === "group" && <button className="primary wide" disabled={!groupName.trim() || !selected.length} onClick={() => void createGroup()}>创建群聊</button>}
  </section></div>;
}

function GroupSettings({ conversation, me, onClose, onChanged }: { conversation: ConversationDto; me: UserSummary; onClose: () => void; onChanged: () => void }) {
  const [adding, setAdding] = useState(false); const [name, setName] = useState(conversation.name ?? ""); const isOwner = conversation.ownerId === me.id;
  async function rename() { await api(`/conversations/${conversation.id}`, { method: "PATCH", body: JSON.stringify({ name }) }); onChanged(); }
  async function remove(userId: string) { await api(`/conversations/${conversation.id}/members/${userId}`, { method: "DELETE" }); onChanged(); }
  async function leave() { await api(`/conversations/${conversation.id}/leave`, { method: "POST" }); onChanged(); onClose(); }
  return <div className="modal-backdrop" onMouseDown={onClose}><section className="modal" onMouseDown={(e) => e.stopPropagation()}><header><h2>群聊设置</h2><button className="icon" onClick={onClose}><X /></button></header>
    {isOwner && <div className="rename-row"><input value={name} onChange={(e) => setName(e.target.value)} /><button onClick={() => void rename()}>保存名称</button></div>}
    <div className="member-heading"><strong>成员 · {conversation.members.length}</strong>{isOwner && <button onClick={() => setAdding(true)}>添加成员</button>}</div>
    <div className="member-list">{conversation.members.map((member) => <div key={member.id}><span className="avatar small">{member.displayName[0]}</span><span>{member.displayName}{member.id === conversation.ownerId && <small> 群主</small>}</span>{isOwner && member.id !== me.id && <button className="danger-text" onClick={() => void remove(member.id)}>移除</button>}</div>)}</div>
    {!isOwner && <button className="danger wide" onClick={() => void leave()}>退出群聊</button>}
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
  async function send(attachments: EncryptedAttachmentMetadata[] = [], keyVersion?: number) { if (!selectedId || !selected || (!text.trim() && !attachments.length)) return; const outgoing = text; setText(""); try { const encrypted = await encryptContent(selected, { text: outgoing || undefined, attachments }, keyVersion); const raw = await api<MessageDto>(`/conversations/${selectedId}/messages`, { method: "POST", body: JSON.stringify({ clientId: crypto.randomUUID(), ...encrypted, attachmentIds: attachments.map((item) => item.id) }) }); const message = await decryptMessage(raw, selected); setMessages((items) => items.some((item) => item.id === message.id) ? items : [...items, message]); } catch (cause) { setText(outgoing); setError(cause instanceof Error ? cause.message : "发送失败"); } }
  async function upload(file?: File) { if (!file || !selected) return; setUploading(true); try { const encrypted = await encryptImage(file, selected); await send([encrypted.metadata], encrypted.keyVersion); } catch (cause) { setError(cause instanceof Error ? cause.message : "图片上传失败"); } finally { setUploading(false); if (fileInput.current) fileInput.current.value = ""; } }
  async function logout() { const refreshToken = await desktopBridge.loadRefreshToken(); if (refreshToken) await api("/auth/logout", { method: "POST", body: JSON.stringify({ refreshToken }) }).catch(() => undefined); setAccessToken(null); await desktopBridge.saveRefreshToken(null); localStorage.removeItem("currentUser"); onLogout(); }
  return <main className="workspace">
    <nav className="rail">
      <div className="rail-avatar" title={`${me.displayName} (@${me.username})`}>{me.displayName[0]}</div>
      <button className="active" title="聊天"><MessageCircle size={22} /></button>
      <button title="通讯录" onClick={() => setDialog("direct")}><Users size={22} /></button>
      <span className="rail-spacer" />
      <div className="secure" title="消息和图片已端到端加密"><ShieldCheck size={19} /></div>
      <button title="退出登录" onClick={() => void logout()}><LogOut size={20} /></button>
    </nav>
    <aside className="sidebar">
      <div className="sidebar-top"><div className="sidebar-search"><Search size={16} /><span>聊天</span></div><button className="square-action" title="发起聊天" onClick={() => setDialog("direct")}><Plus size={18} /></button></div>
      <div className="actions"><button onClick={() => setDialog("direct")}><MessageCircle size={17} />发起私聊</button><button onClick={() => setDialog("group")}><Users size={17} />创建群聊</button></div>
      <div className="conversation-list">{conversations.map((conversation) => <button key={conversation.id} className={conversation.id === selectedId ? "selected" : ""} onClick={() => setSelectedId(conversation.id)}><span className="avatar">{conversation.type === "GROUP" ? <Users size={18} /> : conversationTitle(conversation, me)[0]}</span><span className="conversation-copy"><strong>{conversationTitle(conversation, me)}</strong><small>{conversation.lastMessage?.text ?? (conversation.lastMessage?.attachments.length ? "[图片]" : "暂无消息")}</small></span>{conversation.unreadCount > 0 && <em>{conversation.unreadCount}</em>}</button>)}</div>
    </aside>
    <section className="chat-panel">{selected ? <>
      <header className="chat-header"><div><h2>{conversationTitle(selected, me)}</h2><small>{selected.type === "GROUP" ? `${selected.members.length} 位成员` : "私聊"}</small></div>{selected.type === "GROUP" && <button className="icon" onClick={() => setSettings(true)}><Settings size={20} /></button>}</header>
      <div className="messages">{nextCursor && <button className="load-older" onClick={() => void loadOlder()}>加载更早消息</button>}{messages.map((message, index) => { const mine = message.sender.id === me.id; const showSender = !mine && (index === 0 || messages[index - 1]?.sender.id !== message.sender.id); const imageOnly = !message.text && message.attachments.length > 0; return <article key={message.id} className={`message ${mine ? "mine" : ""}`}>{showSender && <small className="sender">{message.sender.displayName}</small>}<div className={`bubble ${imageOnly ? "image-bubble" : ""}`}>{message.text && <p>{message.text}</p>}{message.attachments.map((attachment) => <ChatImage key={attachment.id} attachment={attachment} conversation={selected} keyVersion={message.keyVersion} />)}<time>{new Date(message.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time></div></article>; })}<div ref={bottom} /></div>
      <footer className="composer"><input ref={fileInput} hidden type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={(e) => void upload(e.target.files?.[0])} /><button className="icon" disabled={uploading} onClick={() => fileInput.current?.click()}><ImagePlus /></button><textarea placeholder={uploading ? "图片上传中…" : "输入消息，按 Enter 发送"} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }} /><button className="send" disabled={!text.trim() || uploading} onClick={() => void send()}><Send size={19} /></button></footer>
    </> : <div className="empty-state"><MessageCircle size={52} /><h2>开始一段对话</h2><p>搜索用户发起私聊，或创建一个群聊。</p></div>}</section>
    {error && <div className="toast" onClick={() => setError("")}>{error}</div>}
    {dialog && <SearchDialog mode={dialog} onClose={() => setDialog(undefined)} onDone={(id) => { setDialog(undefined); void loadConversations(id); }} />}
    {settings && selected && <GroupSettings conversation={selected} me={me} onClose={() => setSettings(false)} onChanged={() => void loadConversations()} />}
  </main>;
}

export function App() {
  const [me, setMe] = useState<UserSummary | null>(() => { try { return JSON.parse(localStorage.getItem("currentUser") ?? "null"); } catch { return null; } });
  const [booting, setBooting] = useState(true);
  useEffect(() => { void refreshSession().then((ok) => { if (!ok) setMe(null); setBooting(false); }); }, []);
  if (booting) return <main className="splash"><div className="brand-mark"><MessageCircle /></div><span>Chat Lite</span></main>;
  return me ? <Workspace me={me} onLogout={() => setMe(null)} /> : <Login onAuthenticated={setMe} />;
}
