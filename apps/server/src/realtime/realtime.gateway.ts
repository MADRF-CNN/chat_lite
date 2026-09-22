import { Injectable } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { ConnectedSocket, MessageBody, OnGatewayConnection, SubscribeMessage, WebSocketGateway, WebSocketServer } from "@nestjs/websockets";
import type { ServerToClientEvents, ClientToServerEvents, MessageDto } from "@chat-lite/shared";
import { Server, Socket } from "socket.io";
import { PrismaService } from "../prisma/prisma.service";

type AuthSocket = Socket<ClientToServerEvents, ServerToClientEvents> & { data: { userId?: string } };

@Injectable()
@WebSocketGateway({ cors: { origin: true, credentials: true } })
export class RealtimeGateway implements OnGatewayConnection {
  @WebSocketServer() server!: Server<ClientToServerEvents, ServerToClientEvents>;
  constructor(private readonly jwt: JwtService, private readonly prisma: PrismaService) {}

  async handleConnection(client: AuthSocket) {
    const token = client.handshake.auth.token as string | undefined;
    try {
      if (!token) throw new Error("missing token");
      const payload = await this.jwt.verifyAsync<{ sub: string }>(token, { secret: process.env.JWT_ACCESS_SECRET });
      client.data.userId = payload.sub;
      client.join(`user:${payload.sub}`);
    } catch {
      client.disconnect(true);
    }
  }

  @SubscribeMessage("conversation:join")
  async join(@ConnectedSocket() client: AuthSocket, @MessageBody() conversationId: string) {
    if (!client.data.userId) return;
    const membership = await this.prisma.conversationMember.findUnique({
      where: { conversationId_userId: { conversationId, userId: client.data.userId } },
    });
    if (membership) client.join(`conversation:${conversationId}`);
  }

  emitMessage(message: MessageDto) {
    this.server.to(`conversation:${message.conversationId}`).emit("message:new", message);
  }

  emitUser(userId: string, event: "conversation:updated" | "membership:changed", conversationId: string) {
    this.server.to(`user:${userId}`).emit(event, conversationId);
  }

  async emitConversationChanged(conversationId: string, event: "conversation:updated" | "membership:changed" = "conversation:updated") {
    const members = await this.prisma.conversationMember.findMany({ where: { conversationId }, select: { userId: true } });
    for (const member of members) this.server.to(`user:${member.userId}`).emit(event, conversationId);
  }
}
