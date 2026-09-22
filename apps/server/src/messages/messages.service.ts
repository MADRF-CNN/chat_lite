import { BadRequestException, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { ConversationsService, toMessageDto } from "../conversations/conversations.service";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import { SendMessageDto } from "./messages.dto";

const include = { sender: { select: { id: true, username: true, displayName: true } }, attachments: true } satisfies Prisma.MessageInclude;

@Injectable()
export class MessagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly conversations: ConversationsService,
    private readonly realtime: RealtimeGateway,
  ) {}

  async list(conversationId: string, userId: string, cursor?: string, limit = 30) {
    await this.conversations.assertMember(conversationId, userId);
    const take = Math.min(Math.max(limit, 1), 100);
    const rows = await this.prisma.message.findMany({
      where: { conversationId },
      include,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: take + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const nextCursor = rows.length > take ? rows[take - 1]?.id ?? null : null;
    return { items: rows.slice(0, take).reverse().map(toMessageDto), nextCursor };
  }

  async send(conversationId: string, userId: string, dto: SendMessageDto) {
    await this.conversations.assertMember(conversationId, userId);
    const text = dto.text?.trim() || null;
    const encrypted = Boolean(dto.ciphertext || dto.nonce || dto.keyVersion);
    if (encrypted && (!dto.ciphertext || !dto.nonce || !dto.keyVersion)) throw new BadRequestException("加密消息参数不完整");
    if (!encrypted) throw new BadRequestException("客户端版本过旧，服务器只接受端到端加密消息");
    if (encrypted && text) throw new BadRequestException("加密消息不能包含明文正文");
    const existing = await this.prisma.message.findUnique({ where: { senderId_clientId: { senderId: userId, clientId: dto.clientId } }, include });
    if (existing) return toMessageDto(existing);
    const attachments = dto.attachmentIds.length
      ? await this.prisma.attachment.findMany({ where: { id: { in: dto.attachmentIds }, uploadedById: userId, messageId: null } })
      : [];
    if (attachments.length !== dto.attachmentIds.length) throw new BadRequestException("图片不存在或已被使用");
    if (encrypted) {
      if (attachments.some((item) => !item.encrypted)) throw new BadRequestException("加密消息不能引用明文图片");
      const latestKey = await this.prisma.conversationKey.findFirst({
        where: { conversationId }, orderBy: { version: "desc" },
        include: { envelopes: { select: { userId: true } } },
      });
      const memberIds = (await this.prisma.conversationMember.findMany({ where: { conversationId }, select: { userId: true } })).map((item) => item.userId).sort();
      const envelopeIds = latestKey?.envelopes.map((item) => item.userId).sort() ?? [];
      if (!latestKey || latestKey.version !== dto.keyVersion || memberIds.join(":") !== envelopeIds.join(":")) {
        throw new BadRequestException("会话密钥需要更新");
      }
    }
    const message = await this.prisma.$transaction(async (tx) => {
      const created = await tx.message.create({ data: { conversationId, senderId: userId, clientId: dto.clientId, text, ciphertext: dto.ciphertext, nonce: dto.nonce, keyVersion: dto.keyVersion } });
      if (attachments.length) await tx.attachment.updateMany({ where: { id: { in: dto.attachmentIds } }, data: { messageId: created.id } });
      await tx.conversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } });
      return tx.message.findUniqueOrThrow({ where: { id: created.id }, include });
    });
    const result = toMessageDto(message);
    this.realtime.emitMessage(result);
    await this.realtime.emitConversationChanged(conversationId);
    return result;
  }
}
