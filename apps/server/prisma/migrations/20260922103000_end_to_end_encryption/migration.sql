ALTER TABLE "User" ADD COLUMN "publicKey" TEXT;

ALTER TABLE "Message"
  ADD COLUMN "ciphertext" TEXT,
  ADD COLUMN "nonce" TEXT,
  ADD COLUMN "keyVersion" INTEGER;

ALTER TABLE "Attachment" ADD COLUMN "encrypted" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "ConversationKey" (
  "id" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "conversationId" TEXT NOT NULL,
  CONSTRAINT "ConversationKey_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ConversationKeyEnvelope" (
  "conversationKeyId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "encryptedKey" TEXT NOT NULL,
  CONSTRAINT "ConversationKeyEnvelope_pkey" PRIMARY KEY ("conversationKeyId", "userId")
);

CREATE UNIQUE INDEX "ConversationKey_conversationId_version_key" ON "ConversationKey"("conversationId", "version");
CREATE INDEX "ConversationKey_conversationId_createdAt_idx" ON "ConversationKey"("conversationId", "createdAt");
CREATE INDEX "ConversationKeyEnvelope_userId_idx" ON "ConversationKeyEnvelope"("userId");

ALTER TABLE "ConversationKey" ADD CONSTRAINT "ConversationKey_conversationId_fkey"
  FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ConversationKeyEnvelope" ADD CONSTRAINT "ConversationKeyEnvelope_conversationKeyId_fkey"
  FOREIGN KEY ("conversationKeyId") REFERENCES "ConversationKey"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ConversationKeyEnvelope" ADD CONSTRAINT "ConversationKeyEnvelope_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
