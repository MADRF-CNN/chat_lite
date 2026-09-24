import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ConversationDto, EncryptedAttachmentMetadata, MessageDto, UserSummary } from "@chat-lite/shared";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ChevronsRight, ImagePlus, LogOut, MessageCircle, PanelLeftClose, PanelLeftOpen, Plus, Search, Send, Settings, Users } from "lucide-react";
import { io, Socket } from "socket.io-client";
import { api, API_URL, assertSecureTransport, authenticate, authenticatedImage, desktopBridge, getAccessToken, refreshSession, setAccessToken, SOCKET_URL } from "./api";
import { conversationTitle } from "./conversation";
import { decryptImage, decryptMessage, encryptContent, encryptImage, ensureIdentity } from "./crypto";
import { ensureNotificationPermission, isChatWindowFocused, notifyIncomingMessage, shouldNotifyIncoming } from "./notifications";
import { applyStyle, loadSettings, saveSettings, STYLE_OPTIONS, type Settings as AppSettings } from "./settings";

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

function WindowDragRegion() {
  async function startDragging(event: React.MouseEvent) {
    if (event.button !== 0 || !("__TAURI_INTERNALS__" in window)) return;
    await getCurrentWindow().startDragging();
  }
  return <div className="window-drag-region" data-tauri-drag-region onMouseDown={(event) => void startDragging(event)} />;
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
  return <main className="auth-page"><WindowDragRegion />
    <section className="auth-card terminal-window">
      <div className="terminal-titlebar"><span>Chat Lite</span></div>
      <div className="auth-content">
      <h1>Chat Lite</h1><p className="muted">安全、轻量的聊天工具</p>
      <div className="auth-tabs"><button type="button" className={mode === "login" ? "active" : ""} onClick={() => setMode("login")}>登录</button><button type="button" className={mode === "register" ? "active" : ""} onClick={() => setMode("register")}>注册</button></div>
      <form onSubmit={submit}>
        <label><span>username:</span><input autoFocus value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} minLength={3} required /></label>
        {mode === "register" && <label><span>display_name:</span><input value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} required /></label>}
        <label><span>password:</span><input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} minLength={8} required /></label>
        {mode === "register" && <label><span>invite_code:</span><input value={form.inviteCode} onChange={(e) => setForm({ ...form, inviteCode: e.target.value })} required /></label>}
        {error && <p className="error">{error}</p>}
        <button className="primary wide" disabled={busy}>{busy ? "连接中..." : mode === "login" ? "登录" : "创建账号"}</button>
      </form>
      </div>
    </section>
  </main>;
}

function ChatImage({ attachment, conversation, keyVersion, onLoaded }: { attachment: MessageDto["attachments"][number]; conversation: ConversationDto; keyVersion?: number | null; onLoaded?: () => void }) {
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
  const frameAspect = attachment.width && attachment.height ? `${attachment.width} / ${attachment.height}` : undefined;
  return <><div className="chat-image"><div className="image-meta"><span>{attachment.originalName}</span><span>{attachment.width}×{attachment.height} · {formatBytes(attachment.size)}</span></div><div className="image-frame" style={frameAspect ? { aspectRatio: frameAspect, maxHeight: 240 } : undefined} onClick={() => void open()}>{src ? <img src={src} alt={attachment.originalName} onLoad={onLoaded} /> : <div className="image-loading">正在解密图片...</div>}</div><div className="image-actions"><span>已加密</span><button onClick={(event) => void save(event)}>保存</button></div></div>{fullSrc && <div className="lightbox" onClick={() => { URL.revokeObjectURL(fullSrc); setFullSrc(undefined); }}><div className="lightbox-title">{attachment.originalName}</div><img src={fullSrc} alt={attachment.originalName} /><button>关闭</button></div>}</>;
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
    <header><h2>{mode === "direct" ? "发起私聊" : mode === "group" ? "创建群聊" : "添加成员"}</h2><button className="icon" onClick={onClose}>×</button></header>
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
  return <div className="modal-backdrop" onMouseDown={onClose}><section className="modal terminal-window" onMouseDown={(e) => e.stopPropagation()}><header><h2>群聊设置</h2><button className="icon" onClick={onClose}>×</button></header>
    {isOwner && <div className="rename-row"><input value={name} onChange={(e) => setName(e.target.value)} /><button onClick={() => void rename()}>保存</button></div>}
    <div className="member-heading"><strong>{conversation.members.length} 位成员</strong>{isOwner && <button onClick={() => setAdding(true)}>添加成员</button>}</div>
    <div className="member-list">{conversation.members.map((member) => <div key={member.id}><span className="avatar small">{member.displayName[0]}</span><span>{member.displayName}{member.id === conversation.ownerId && <small> · 群主</small>}</span>{isOwner && member.id !== me.id && <button className="danger-text" onClick={() => void remove(member.id)}>移除</button>}</div>)}</div>
    {!isOwner && <button className="danger wide" onClick={() => void leave()}>退出群聊</button>}
    {adding && <SearchDialog mode="add-member" conversation={conversation} onClose={() => setAdding(false)} onDone={() => { setAdding(false); onChanged(); }} />}
  </section></div>;
}

function SettingsDialog({ settings, onChange, onClose, me, apiUrl }: { settings: AppSettings; onChange: (patch: Partial<AppSettings>) => void; onClose: () => void; me: UserSummary; apiUrl: string }) {
  return <div className="modal-backdrop" onMouseDown={onClose}><section className="modal" onMouseDown={(event) => event.stopPropagation()}>
    <header><h2>设置</h2><button className="icon" onClick={onClose}>×</button></header>
    <div className="settings-group">
      <h3>外观</h3>
      <div className="style-grid">{STYLE_OPTIONS.map((option) => <button key={option.id} className={`style-card ${settings.style === option.id ? "on" : ""}`} onClick={() => onChange({ style: option.id })}><b>{option.name}</b><small>{option.desc}</small></button>)}</div>
    </div>
    <div className="settings-group">
      <h3>行为</h3>
      <label className="switch-row"><span><b>启动时收起会话栏</b><small>打开就只显示对话内容</small></span><input className="switch" type="checkbox" checked={settings.collapseSidebar} onChange={(event) => onChange({ collapseSidebar: event.target.checked })} /></label>
      <label className="switch-row"><span><b>桌面通知</b><small>收到新消息时发送系统通知</small></span><input className="switch" type="checkbox" checked={settings.notifications} onChange={(event) => onChange({ notifications: event.target.checked })} /></label>
      <label className="switch-row"><span><b>老板键 ⌘⇧H</b><small>按下立即把窗口缩到屏幕右侧边缘</small></span><input className="switch" type="checkbox" checked={settings.bossKey} onChange={(event) => onChange({ bossKey: event.target.checked })} /></label>
      <div className="switch-row"><span><b>⌘B</b><small>收起 / 展开会话栏（始终可用）</small></span></div>
    </div>
    <div className="settings-group">
      <h3>关于</h3>
      <div className="settings-meta"><span>账号：{me.displayName} (@{me.username})</span><span>服务器：<code>{apiUrl}</code></span><span>端到端加密：本机身份私钥 + AES-256-GCM</span></div>
    </div>
  </section></div>;
}

function Workspace({ me, settings, onChangeSettings, onLogout }: { me: UserSummary; settings: AppSettings; onChangeSettings: (patch: Partial<AppSettings>) => void; onLogout: () => void }) {
  const [conversations, setConversations] = useState<ConversationDto[]>([]); const [selectedId, setSelectedId] = useState<string>(); const [messages, setMessages] = useState<MessageDto[]>([]); const [nextCursor, setNextCursor] = useState<string | null>(null); const [text, setText] = useState(""); const [dialog, setDialog] = useState<SearchMode>(); const [settingsOpen, setSettingsOpen] = useState(false); const [groupSettings, setGroupSettings] = useState(false); const [error, setError] = useState(""); const [uploading, setUploading] = useState(false); const [sidebarCollapsed, setSidebarCollapsed] = useState(settings.collapseSidebar); const [edgeMode, setEdgeMode] = useState(false); const socket = useRef<Socket | undefined>(undefined); const selectedIdRef = useRef<string | undefined>(undefined); const conversationsRef = useRef<ConversationDto[]>([]); const settingsRef = useRef(settings); const fileInput = useRef<HTMLInputElement>(null); const messagesContainer = useRef<HTMLDivElement>(null); const bottomAnchor = useRef<HTMLDivElement>(null); const isUserScrolledUp = useRef(false);
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => { try { const stored = localStorage.getItem("sidebarWidth"); return stored ? Math.max(160, Math.min(480, Number(stored))) : 218; } catch { return 218; } });
  const isDraggingSidebar = useRef(false);
  function startResizingSidebar(event: React.MouseEvent) {
    event.preventDefault(); isDraggingSidebar.current = true;
    document.body.style.cursor = "col-resize"; document.body.style.userSelect = "none";
    function onMouseMove(e: MouseEvent) { if (!isDraggingSidebar.current) return; setSidebarWidth(Math.max(160, Math.min(480, e.clientX))); }
    function onMouseUp(e: MouseEvent) {
      isDraggingSidebar.current = false; document.body.style.cursor = ""; document.body.style.userSelect = "";
      window.removeEventListener("mousemove", onMouseMove); window.removeEventListener("mouseup", onMouseUp);
      const finalWidth = Math.max(160, Math.min(480, e.clientX));
      try { localStorage.setItem("sidebarWidth", String(finalWidth)); } catch {}
    }
    window.addEventListener("mousemove", onMouseMove); window.addEventListener("mouseup", onMouseUp);
  }
  const selected = conversations.find((item) => item.id === selectedId);
  useEffect(() => { settingsRef.current = settings; }, [settings]);
  function scrollToBottom(smooth = false) {
    const el = messagesContainer.current;
    if (!el) return;
    if (smooth) {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    } else {
      el.scrollTop = el.scrollHeight;
      bottomAnchor.current?.scrollIntoView({ block: "end", behavior: "instant" });
    }
  }
  function handleScroll() {
    const el = messagesContainer.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    isUserScrolledUp.current = distanceFromBottom > 60;
  }
  async function loadConversations(select?: string) { const raw = await api<ConversationDto[]>("/conversations"); const items = await Promise.all(raw.map(async (conversation) => ({ ...conversation, lastMessage: conversation.lastMessage ? await decryptMessage(conversation.lastMessage, conversation) : null }))); conversationsRef.current = items; setConversations(items); setSelectedId((current) => select ?? current ?? items[0]?.id); return items; }
  useEffect(() => { selectedIdRef.current = selectedId; }, [selectedId]);
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === "b") { event.preventDefault(); setSidebarCollapsed((value) => !value); return; }
      if (key === "h" && event.shiftKey && settingsRef.current.bossKey) { event.preventDefault(); void enterEdgeMode(); }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
  useEffect(() => { let disposed = false; let connection: Socket | undefined; void (async () => { try { await ensureIdentity(me); await loadConversations(); if (settingsRef.current.notifications) void ensureNotificationPermission(); assertSecureTransport(SOCKET_URL); if (disposed) return; connection = io(SOCKET_URL, { auth: { token: getAccessToken() }, transports: ["websocket"] }); socket.current = connection; connection.on("message:new", (incoming: MessageDto) => { void (async () => { const conversation = conversationsRef.current.find((item) => item.id === incoming.conversationId); const message = conversation ? await decryptMessage(incoming, conversation) : incoming; const windowFocused = await isChatWindowFocused(); const viewingConversation = windowFocused && message.conversationId === selectedIdRef.current; if (message.conversationId === selectedIdRef.current) { setMessages((items) => items.some((item) => item.id === message.id) ? items : [...items, message]); if (!isUserScrolledUp.current) requestAnimationFrame(() => scrollToBottom(true)); } if (viewingConversation) await api(`/conversations/${message.conversationId}/read`, { method: "POST", body: JSON.stringify({ messageId: message.id }) }); if (settingsRef.current.notifications && conversation && shouldNotifyIncoming(message, { currentUserId: me.id, selectedConversationId: selectedIdRef.current, windowFocused })) await notifyIncomingMessage(message, conversationTitle(conversation, me)); await loadConversations(); })(); }); connection.on("conversation:updated", () => void loadConversations()); connection.on("membership:changed", () => void loadConversations()); } catch (cause) { setError(cause instanceof Error ? cause.message : "端到端加密初始化失败"); } })(); return () => { disposed = true; connection?.disconnect(); }; }, []);
  useEffect(() => {
    if (!selectedId || !selected) return;
    isUserScrolledUp.current = false;
    setMessages([]);
    socket.current?.emit("conversation:join", selectedId);
    void api<{ items: MessageDto[]; nextCursor: string | null }>(`/conversations/${selectedId}/messages`).then(async ({ items, nextCursor: cursor }) => {
      const decrypted = await Promise.all(items.map((message) => decryptMessage(message, selected)));
      setMessages(decrypted);
      setNextCursor(cursor);
      isUserScrolledUp.current = false;
      requestAnimationFrame(() => scrollToBottom(false));
      const last = decrypted.at(-1);
      if (last) void api(`/conversations/${selectedId}/read`, { method: "POST", body: JSON.stringify({ messageId: last.id }) }).then(() => loadConversations());
    }).catch((cause) => setError(cause instanceof Error ? cause.message : "消息加载失败"));
  }, [selectedId]);
  useLayoutEffect(() => {
    if (!isUserScrolledUp.current && messages.length > 0) {
      scrollToBottom(false);
      const f1 = requestAnimationFrame(() => scrollToBottom(false));
      const f2 = requestAnimationFrame(() => {
        requestAnimationFrame(() => scrollToBottom(false));
      });
      const t1 = setTimeout(() => scrollToBottom(false), 50);
      const t2 = setTimeout(() => scrollToBottom(false), 200);
      return () => {
        cancelAnimationFrame(f1);
        cancelAnimationFrame(f2);
        clearTimeout(t1);
        clearTimeout(t2);
      };
    }
  }, [messages]);
  useEffect(() => {
    const el = messagesContainer.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      if (!isUserScrolledUp.current) scrollToBottom(false);
    });
    observer.observe(el);
    const mutationObserver = new MutationObserver(() => {
      if (!isUserScrolledUp.current) scrollToBottom(false);
    });
    mutationObserver.observe(el, { childList: true, subtree: true, attributes: true });
    return () => {
      observer.disconnect();
      mutationObserver.disconnect();
    };
  }, [selectedId]);
  async function loadOlder() {
    if (!selectedId || !selected || !nextCursor) return;
    isUserScrolledUp.current = true;
    const el = messagesContainer.current;
    const prevHeight = el?.scrollHeight ?? 0;
    const prevTop = el?.scrollTop ?? 0;
    const page = await api<{ items: MessageDto[]; nextCursor: string | null }>(`/conversations/${selectedId}/messages?cursor=${encodeURIComponent(nextCursor)}`);
    const decrypted = await Promise.all(page.items.map((message) => decryptMessage(message, selected)));
    setMessages((items) => [...decrypted, ...items]);
    setNextCursor(page.nextCursor);
    requestAnimationFrame(() => {
      if (el) el.scrollTop = prevTop + (el.scrollHeight - prevHeight);
    });
  }
  async function send(attachments: EncryptedAttachmentMetadata[] = [], keyVersion?: number) {
    if (!selectedId || !selected || (!text.trim() && !attachments.length)) return;
    const outgoing = text;
    if (outgoing.length > 4000) { setError("消息不能超过 4000 个字符"); return; }
    setText("");
    try {
      const encrypted = await encryptContent(selected, { text: outgoing || undefined, attachments }, keyVersion);
      const raw = await api<MessageDto>(`/conversations/${selectedId}/messages`, { method: "POST", body: JSON.stringify({ clientId: crypto.randomUUID(), ...encrypted, attachmentIds: attachments.map((item) => item.id) }) });
      const message = await decryptMessage(raw, selected);
      isUserScrolledUp.current = false;
      setMessages((items) => items.some((item) => item.id === message.id) ? items : [...items, message]);
      requestAnimationFrame(() => scrollToBottom(true));
    } catch (cause) {
      setText(outgoing);
      setError(cause instanceof Error ? cause.message : "发送失败");
    }
  }
  async function upload(file?: File) { if (!file || !selected || uploading) return; setUploading(true); try { const encrypted = await encryptImage(file, selected); await send([encrypted.metadata], encrypted.keyVersion); } catch (cause) { setError(cause instanceof Error ? cause.message : "图片上传失败"); } finally { setUploading(false); if (fileInput.current) fileInput.current.value = ""; } }
  function handlePaste(event: React.ClipboardEvent<HTMLTextAreaElement>) {
    const file = Array.from(event.clipboardData.files).find((item) => item.type.startsWith("image/"))
      ?? Array.from(event.clipboardData.items).find((item) => item.type.startsWith("image/"))?.getAsFile();
    if (file) {
      event.preventDefault();
      const ext = file.type.split("/")[1] || "png";
      const normalized = new File([file], file.name && file.name !== "image.png" ? file.name : `pasted-${Date.now()}.${ext}`, { type: file.type });
      void upload(normalized);
    }
  }
  function handleDrop(event: React.DragEvent) {
    event.preventDefault();
    const file = Array.from(event.dataTransfer.files).find((item) => item.type.startsWith("image/"));
    if (file) void upload(file);
  }
  async function logout() { const refreshToken = await desktopBridge.loadRefreshToken(); if (refreshToken) await api("/auth/logout", { method: "POST", body: JSON.stringify({ refreshToken }) }).catch(() => undefined); setAccessToken(null); await desktopBridge.saveRefreshToken(null); localStorage.removeItem("currentUser"); onLogout(); }
  async function enterEdgeMode() { setEdgeMode(true); try { await desktopBridge.setEdgeCollapsed(true); } catch (cause) { setEdgeMode(false); setError(cause instanceof Error ? cause.message : "贴边失败"); } }
  async function leaveEdgeMode() { try { await desktopBridge.setEdgeCollapsed(false); setEdgeMode(false); } catch (cause) { setError(cause instanceof Error ? cause.message : "展开失败"); } }
  if (edgeMode) { const unread = conversations.reduce((total, item) => total + item.unreadCount, 0); return <main className="edge-shell"><button className="edge-handle" aria-label="展开 Chat Lite" title="展开 Chat Lite" onClick={() => void leaveEdgeMode()}><MessageCircle size={18} />{unread > 0 && <em>{unread > 99 ? "99+" : unread}</em>}</button></main>; }
  return <main className={`workspace ${sidebarCollapsed ? "sidebar-collapsed" : ""}`} style={{ ["--sidebar-w" as string]: `${sidebarWidth}px` }}><WindowDragRegion />
    <aside className="sidebar">
      <div className="sidebar-head">
        <div className="user-chip" title={`@${me.username}`}><span className="avatar compact">{me.displayName[0]}</span><strong>{me.displayName}</strong></div>
        <div className="toolbar"><button title="设置" onClick={() => setSettingsOpen(true)}><Settings size={15} /></button><button title="发起私聊" onClick={() => setDialog("direct")}><Plus size={15} /></button><button title="创建群聊" onClick={() => setDialog("group")}><Users size={15} /></button><button title="退出登录" onClick={() => void logout()}><LogOut size={15} /></button></div>
      </div>
      <div className="conversation-list">{conversations.map((conversation) => <button key={conversation.id} className={conversation.id === selectedId ? "selected" : ""} onClick={() => setSelectedId(conversation.id)}><span className="avatar">{conversation.type === "GROUP" ? <Users size={14} /> : conversationTitle(conversation, me)[0]}</span><span className="conversation-copy"><strong>{conversationTitle(conversation, me)}</strong><small>{conversation.lastMessage?.text ?? (conversation.lastMessage?.attachments.length ? "图片" : "")}</small></span>{conversation.unreadCount > 0 && <em>{conversation.unreadCount}</em>}</button>)}</div>
      {!sidebarCollapsed && <div className="sidebar-resizer" onMouseDown={startResizingSidebar} title="拖拽调整侧边栏宽度" />}
    </aside>
    <section className="chat-panel">{selected ? <>
      <header className="chat-header"><div className="chat-title"><button className="icon sidebar-toggle" aria-label={sidebarCollapsed ? "展开会话栏" : "收起会话栏"} title={sidebarCollapsed ? "展开会话栏" : "收起会话栏"} onClick={() => setSidebarCollapsed((value) => !value)}>{sidebarCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}</button>{settings.style === "editor" && <div className="skin-tabs">{conversations.slice(0, 4).map((item, index) => <button key={item.id} className={`skin-tab ${item.id === selectedId ? "on" : ""}`} onClick={() => setSelectedId(item.id)}>{conversationTitle(item, me)}{[".log", ".md", ".txt"][index % 3] ?? ".log"}</button>)}</div>}<div><h2>{conversationTitle(selected, me)}</h2><small>{selected.type === "GROUP" ? `${selected.members.length} 位成员` : "私聊"} · 已加密</small></div></div><div className="header-actions">{selected.type === "GROUP" && <button className="icon" title="群聊设置" onClick={() => setGroupSettings(true)}><Settings size={16} /></button>}<button className="icon edge-collapse-button" aria-label="隐藏到屏幕右侧" title="隐藏到屏幕右侧（⌘⇧H）" onClick={() => void enterEdgeMode()}><ChevronsRight size={17} /></button></div></header>
      {settings.style === "table" && <div className="skin-table-head"><span>TIME</span><span>USER</span><span>STATE</span><span>MESSAGE</span></div>}
      <div className="messages" ref={messagesContainer} onScroll={handleScroll}>{nextCursor && <button className="load-older" onClick={() => void loadOlder()}>加载更早消息</button>}{messages.map((message) => { const mine = message.sender.id === me.id; return <article key={message.id} className={`message ${mine ? "mine" : ""}`}><div className="log-prefix"><time>{terminalTime(message.createdAt)}</time><strong>{mine ? "我" : message.sender.username}</strong><span className="sep">&gt;</span><span className="state">OK</span></div><div className="log-content">{message.text && <p>{message.text}</p>}{message.attachments.map((attachment) => <ChatImage key={attachment.id} attachment={attachment} conversation={selected} keyVersion={message.keyVersion} onLoaded={() => { if (!isUserScrolledUp.current) scrollToBottom(false); }} />)}</div></article>; })}<div ref={bottomAnchor} style={{ height: 1, marginTop: -1, pointerEvents: "none" }} /></div>
      <footer className="composer" onDrop={handleDrop} onDragOver={(e) => e.preventDefault()}><input ref={fileInput} hidden type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={(e) => void upload(e.target.files?.[0])} /><button className="icon" title="发送图片" disabled={uploading} onClick={() => fileInput.current?.click()}><ImagePlus size={16} /></button><textarea aria-label="消息内容" placeholder={uploading ? "正在加密图片..." : "输入消息（可直接粘贴图片）"} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }} onPaste={handlePaste} onDrop={handleDrop} onDragOver={(e) => e.preventDefault()} /><button className="send" title="发送" disabled={!text.trim() || uploading} onClick={() => void send()}><Send size={15} /></button></footer>
    </> : <div className="empty-state"><button className="icon sidebar-toggle" title={sidebarCollapsed ? "展开会话栏" : "收起会话栏"} onClick={() => setSidebarCollapsed((value) => !value)}>{sidebarCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}</button><p>选择会话</p><button className="icon edge-action" title="隐藏到屏幕右侧" onClick={() => void enterEdgeMode()}><ChevronsRight size={17} /></button></div>}</section>
    {error && <div className="toast" onClick={() => setError("")}><span>错误：</span>{error}</div>}
    {dialog && <SearchDialog mode={dialog} onClose={() => setDialog(undefined)} onDone={(id) => { setDialog(undefined); void loadConversations(id); }} />}
    {groupSettings && selected && <GroupSettings conversation={selected} me={me} onClose={() => setGroupSettings(false)} onChanged={() => void loadConversations()} />}
    {settingsOpen && <SettingsDialog settings={settings} onChange={onChangeSettings} onClose={() => setSettingsOpen(false)} me={me} apiUrl={API_URL} />}
  </main>;
}

export function App() {
  const [me, setMe] = useState<UserSummary | null>(() => { try { return JSON.parse(localStorage.getItem("currentUser") ?? "null"); } catch { return null; } });
  const [booting, setBooting] = useState(true);
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());
  useEffect(() => { applyStyle(settings.style); }, [settings.style]);
  function changeSettings(patch: Partial<AppSettings>) { setSettings((current) => { const next = { ...current, ...patch }; saveSettings(next); return next; }); }
  useEffect(() => { void refreshSession().then((ok) => { if (!ok) setMe(null); setBooting(false); }); }, []);
  if (booting) return <main className="splash"><WindowDragRegion /><span>Chat Lite</span><small>正在启动...</small></main>;
  return me ? <Workspace me={me} settings={settings} onChangeSettings={changeSettings} onLogout={() => setMe(null)} /> : <Login onAuthenticated={setMe} />;
}
