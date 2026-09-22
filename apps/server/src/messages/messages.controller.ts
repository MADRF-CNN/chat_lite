import { Body, Controller, Get, Param, ParseIntPipe, Post, Query, UseGuards } from "@nestjs/common";
import { AuthUser, CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { SendMessageDto } from "./messages.dto";
import { MessagesService } from "./messages.service";

@Controller("conversations/:conversationId/messages")
@UseGuards(JwtAuthGuard)
export class MessagesController {
  constructor(private readonly messages: MessagesService) {}
  @Get() list(@Param("conversationId") id: string, @CurrentUser() user: AuthUser, @Query("cursor") cursor?: string, @Query("limit", new ParseIntPipe({ optional: true })) limit?: number) {
    return this.messages.list(id, user.sub, cursor, limit);
  }
  @Post() send(@Param("conversationId") id: string, @CurrentUser() user: AuthUser, @Body() dto: SendMessageDto) { return this.messages.send(id, user.sub, dto); }
}
