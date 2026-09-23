import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { ConversationType, Prisma } from "@prisma/client";
import type { ConversationDto, MessageDto } from "@chat-lite/shared";
import { PrismaService } from "../prisma/prisma.service";
import { RealtimeGateway } from "../realtime/realtime.gateway";

const messageInclude = { sender: { select: { id: true, username: true, displayName: true } }, attachments: true } satisfies Prisma.MessageInclude;

export function toMessageDto(message: Prisma.MessageGetPayload<{ include: typeof messageInclude }>): MessageDto {
  return {
    id: message.id,
    clientId: message.clientId,
    conversationId: message.conversationId,
    text: message.text,
    ciphertext: message.ciphertext,
    nonce: message.nonce,
    keyVersion: message.keyVersion,
    createdAt: message.createdAt.toISOString(),
    sender: message.sender,
    attachments: message.attachments.map(({ id, mimeType, width, height, size, originalName, encrypted }) => ({ id, mimeType, width, height, size, originalName, encrypted })),
  };
}

@Injectable()
export class ConversationsService {
  constructor(private readonly prisma: PrismaService, private readonly realtime?: RealtimeGateway) {}

  async assertMember(conversationId: string, userId: string) {
    const member = await this.prisma.conversationMember.findUnique({ where: { conversationId_userId: { conversationId, userId } } });
    if (!member) throw new ForbiddenException("你不是该会话成员");
    return member;
  }

  async list(userId: string): Promise<ConversationDto[]> {
    const rows = await this.prisma.conversation.findMany({
      where: { members: { some: { userId } } },
      include: {
        members: { include: { user: { select: { id: true, username: true, displayName: true } } } },
        messages: { take: 1, orderBy: [{ createdAt: "desc" }, { id: "desc" }], include: messageInclude },
      },
      orderBy: { updatedAt: "desc" },
    });
    return Promise.all(rows.map(async (row) => {
      const membership = row.members.find((member) => member.userId === userId)!;
      const lastRead = membership.lastReadMessageId
        ? await this.prisma.message.findUnique({ where: { id: membership.lastReadMessageId }, select: { createdAt: true } })
        : null;
      const unreadCount = await this.prisma.message.count({
        where: { conversationId: row.id, senderId: { not: userId }, ...(lastRead ? { createdAt: { gt: lastRead.createdAt } } : {}) },
      });
      return {
        id: row.id,
        type: row.type,
        name: row.name,
        ownerId: row.ownerId,
        members: row.members.map((member) => member.user),
        lastMessage: row.messages[0] ? toMessageDto(row.messages[0]) : null,
        unreadCount,
        updatedAt: row.updatedAt.toISOString(),
      };
    }));
  }

  async createDirect(userId: string, otherId: string) {
    if (userId === otherId) throw new BadRequestException("不能与自己创建私聊");
    if (!(await this.prisma.user.findUnique({ where: { id: otherId } }))) throw new NotFoundException("用户不存在");
    const directKey = [userId, otherId].sort().join(":");
    try {
      const result = await this.prisma.conversation.create({
        data: { type: ConversationType.DIRECT, directKey, members: { create: [{ userId }, { userId: otherId }] } },
        select: { id: true },
      });
      this.realtime?.emitUser(otherId, "membership:changed", result.id);
      return result;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return this.prisma.conversation.findUniqueOrThrow({ where: { directKey }, select: { id: true } });
      }
      throw error;
    }
  }

  async createGroup(userId: string, name: string, memberIds: string[]) {
    const uniqueIds = [...new Set([userId, ...memberIds])];
    if (uniqueIds.length > 100) throw new BadRequestException("群成员不能超过 100 人");
    const count = await this.prisma.user.count({ where: { id: { in: uniqueIds } } });
    if (count !== uniqueIds.length) throw new BadRequestException("部分用户不存在");
    const result = await this.prisma.conversation.create({
      data: { type: ConversationType.GROUP, name: name.trim(), ownerId: userId, members: { create: uniqueIds.map((id) => ({ userId: id })) } },
      select: { id: true },
    });
    await this.realtime?.emitConversationChanged(result.id, "membership:changed");
    return result;
  }

  private async requireGroupOwner(conversationId: string, userId: string) {
    const conversation = await this.prisma.conversation.findUnique({ where: { id: conversationId } });
    if (!conversation) throw new NotFoundException("会话不存在");
    if (conversation.type !== ConversationType.GROUP || conversation.ownerId !== userId) throw new ForbiddenException("仅群主可执行此操作");
    return conversation;
  }

  async rename(conversationId: string, userId: string, name: string) {
    await this.requireGroupOwner(conversationId, userId);
    const result = await this.prisma.conversation.update({ where: { id: conversationId }, data: { name: name.trim() }, select: { id: true, name: true } });
    await this.realtime?.emitConversationChanged(conversationId);
    return result;
  }

  async addMember(conversationId: string, ownerId: string, memberId: string) {
    await this.requireGroupOwner(conversationId, ownerId);
    const count = await this.prisma.conversationMember.count({ where: { conversationId } });
    if (count >= 100) throw new BadRequestException("群成员不能超过 100 人");
    if (!(await this.prisma.user.findUnique({ where: { id: memberId } }))) throw new NotFoundException("用户不存在");
    await this.prisma.conversationMember.upsert({
      where: { conversationId_userId: { conversationId, userId: memberId } },
      create: { conversationId, userId: memberId }, update: {},
    });
    await this.realtime?.emitConversationChanged(conversationId, "membership:changed");
    return { ok: true };
  }

  async removeMember(conversationId: string, ownerId: string, memberId: string) {
    const conversation = await this.requireGroupOwner(conversationId, ownerId);
    if (conversation.ownerId === memberId) throw new BadRequestException("群主不能移除自己");
    await this.prisma.conversationMember.deleteMany({ where: { conversationId, userId: memberId } });
    await this.realtime?.emitConversationChanged(conversationId, "membership:changed");
    this.realtime?.emitUser(memberId, "membership:changed", conversationId);
    return { ok: true };
  }

  async leave(conversationId: string, userId: string) {
    const conversation = await this.prisma.conversation.findUnique({ where: { id: conversationId } });
    if (!conversation || conversation.type !== ConversationType.GROUP) throw new BadRequestException("仅群聊可退出");
    if (conversation.ownerId === userId) throw new BadRequestException("群主需先移除群聊或转让群主；首版暂不支持转让");
    await this.prisma.conversationMember.deleteMany({ where: { conversationId, userId } });
    await this.realtime?.emitConversationChanged(conversationId, "membership:changed");
    return { ok: true };
  }

  async markRead(conversationId: string, userId: string, messageId: string) {
    await this.assertMember(conversationId, userId);
    const message = await this.prisma.message.findFirst({ where: { id: messageId, conversationId } });
    if (!message) throw new BadRequestException("消息不属于该会话");
    const membership = await this.prisma.conversationMember.findUnique({
      where: { conversationId_userId: { conversationId, userId } },
      include: { lastReadMessage: { select: { createdAt: true } } },
    });
    if (!membership?.lastReadMessage || membership.lastReadMessage.createdAt <= message.createdAt) {
      await this.prisma.conversationMember.update({
        where: { conversationId_userId: { conversationId, userId } }, data: { lastReadMessageId: messageId },
      });
    }
    return { ok: true };
  }

  async latestKey(conversationId: string, userId: string) {
    await this.assertMember(conversationId, userId);
    const key = await this.prisma.conversationKey.findFirst({
      where: { conversationId },
      orderBy: { version: "desc" },
      include: { envelopes: { select: { userId: true, encryptedKey: true } } },
    });
    if (!key) return { version: 0, encryptedKey: null, memberIds: [] };
    return {
      version: key.version,
      encryptedKey: key.envelopes.find((item) => item.userId === userId)?.encryptedKey ?? null,
      memberIds: key.envelopes.map((item) => item.userId).sort(),
    };
  }

  async key(conversationId: string, userId: string, version: number) {
    await this.assertMember(conversationId, userId);
    const key = await this.prisma.conversationKey.findUnique({
      where: { conversationId_version: { conversationId, version } },
      include: { envelopes: { select: { userId: true, encryptedKey: true } } },
    });
    if (!key) throw new NotFoundException("会话密钥不存在");
    return { version, encryptedKey: key.envelopes.find((item) => item.userId === userId)?.encryptedKey ?? null, memberIds: key.envelopes.map((item) => item.userId).sort() };
  }

  async createKey(conversationId: string, userId: string, envelopes: { userId: string; encryptedKey: string }[]) {
    await this.assertMember(conversationId, userId);
    const memberIds = (await this.prisma.conversationMember.findMany({ where: { conversationId }, select: { userId: true } })).map((item) => item.userId).sort();
    const unique = new Map(envelopes.map((item) => [item.userId, item.encryptedKey]));
    if (unique.size !== memberIds.length || memberIds.some((id) => !unique.has(id))) throw new BadRequestException("密钥信封必须覆盖当前全部成员");
    const latest = await this.prisma.conversationKey.findFirst({ where: { conversationId }, orderBy: { version: "desc" }, select: { version: true } });
    const version = (latest?.version ?? 0) + 1;
    const key = await this.prisma.conversationKey.create({
      data: { conversationId, version, envelopes: { create: memberIds.map((id) => ({ userId: id, encryptedKey: unique.get(id)! })) } },
      include: { envelopes: { where: { userId }, select: { encryptedKey: true } } },
    });
    return { version: key.version, encryptedKey: key.envelopes[0]!.encryptedKey, memberIds };
  }
}
