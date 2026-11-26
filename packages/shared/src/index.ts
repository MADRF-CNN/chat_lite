export type UserSummary = {
  id: string;
  username: string;
  displayName: string;
};

export type AttachmentDto = {
  id: string;
  mimeType: string;
  width: number;
  height: number;
  size: number;
  originalName: string;
  encrypted?: boolean;
};

export type EncryptedAttachmentMetadata = {
  id: string;
  originalName: string;
  mimeType: string;
  size: number;
  width: number;
  height: number;
  originalNonce: string;
  thumbnailNonce: string;
};

export type QuotedMessageMetadata = {
  id: string;
  senderName: string;
  preview: string;
};

export type EncryptedMessageContent = {
  text?: string;
  attachments: EncryptedAttachmentMetadata[];
  replyTo?: QuotedMessageMetadata;
};

export type MessageDto = {
  id: string;
  clientId: string;
  conversationId: string;
  text: string | null;
  ciphertext?: string | null;
  nonce?: string | null;
  keyVersion?: number | null;
  createdAt: string;
  sender: UserSummary;
  attachments: AttachmentDto[];
  replyTo?: QuotedMessageMetadata;
};

export type ConversationDto = {
  id: string;
  type: "DIRECT" | "GROUP";
  name: string | null;
  ownerId: string | null;
  members: UserSummary[];
  lastMessage: MessageDto | null;
  unreadCount: number;
  updatedAt: string;
};

export type AuthResponse = {
  accessToken: string;
  refreshToken: string;
  user: UserSummary;
};

export type ServerToClientEvents = {
  "message:new": (message: MessageDto) => void;
  "conversation:updated": (conversationId: string) => void;
  "membership:changed": (conversationId: string) => void;
};

export type ClientToServerEvents = {
  "conversation:join": (conversationId: string) => void;
};

export type CliReleaseManifest = {
  version: string;
  publishedAt: string;
  notes?: string;
  sha256: string;
  size: number;
  depsHash: string;
  minNodeMajor: number;
};

export type CliUpdateBundle = {
  version: string;
  depsHash: string;
  notes?: string;
  files: Record<string, string>;
};
