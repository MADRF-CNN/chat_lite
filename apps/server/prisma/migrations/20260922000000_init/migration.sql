CREATE TYPE "UserRole" AS ENUM ('USER', 'ADMIN');
CREATE TYPE "ConversationType" AS ENUM ('DIRECT', 'GROUP');

CREATE TABLE "User" ("id" TEXT PRIMARY KEY, "username" TEXT NOT NULL UNIQUE, "displayName" TEXT NOT NULL, "passwordHash" TEXT NOT NULL, "role" "UserRole" NOT NULL DEFAULT 'USER', "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL);
CREATE TABLE "InviteCode" ("id" TEXT PRIMARY KEY, "codeHash" TEXT NOT NULL UNIQUE, "maxUses" INTEGER NOT NULL DEFAULT 1, "usedCount" INTEGER NOT NULL DEFAULT 0, "expiresAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "createdById" TEXT REFERENCES "User"("id") ON DELETE SET NULL);
CREATE TABLE "RefreshToken" ("id" TEXT PRIMARY KEY, "tokenHash" TEXT NOT NULL UNIQUE, "expiresAt" TIMESTAMP(3) NOT NULL, "revokedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE);
CREATE TABLE "Conversation" ("id" TEXT PRIMARY KEY, "type" "ConversationType" NOT NULL, "name" TEXT, "directKey" TEXT UNIQUE, "ownerId" TEXT REFERENCES "User"("id") ON DELETE SET NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL);
CREATE TABLE "Message" ("id" TEXT PRIMARY KEY, "clientId" TEXT NOT NULL, "text" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "conversationId" TEXT NOT NULL REFERENCES "Conversation"("id") ON DELETE CASCADE, "senderId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT, UNIQUE("senderId", "clientId"));
CREATE TABLE "ConversationMember" ("conversationId" TEXT NOT NULL REFERENCES "Conversation"("id") ON DELETE CASCADE, "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE, "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "lastReadMessageId" TEXT REFERENCES "Message"("id") ON DELETE SET NULL, PRIMARY KEY ("conversationId", "userId"));
CREATE TABLE "Attachment" ("id" TEXT PRIMARY KEY, "objectKey" TEXT NOT NULL UNIQUE, "thumbnailKey" TEXT NOT NULL, "originalName" TEXT NOT NULL, "mimeType" TEXT NOT NULL, "size" INTEGER NOT NULL, "width" INTEGER NOT NULL, "height" INTEGER NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "uploadedById" TEXT NOT NULL, "messageId" TEXT REFERENCES "Message"("id") ON DELETE CASCADE);
CREATE INDEX "RefreshToken_userId_idx" ON "RefreshToken"("userId");
CREATE INDEX "Conversation_updatedAt_idx" ON "Conversation"("updatedAt");
CREATE INDEX "ConversationMember_userId_idx" ON "ConversationMember"("userId");
CREATE INDEX "Message_conversationId_createdAt_idx" ON "Message"("conversationId", "createdAt");
CREATE INDEX "Attachment_uploadedById_idx" ON "Attachment"("uploadedById");
CREATE INDEX "Attachment_messageId_idx" ON "Attachment"("messageId");
