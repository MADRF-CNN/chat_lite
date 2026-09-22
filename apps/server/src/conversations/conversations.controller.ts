import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, UseGuards } from "@nestjs/common";
import { AuthUser, CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { CreateConversationKeyDto, CreateDirectDto, CreateGroupDto, MemberDto, ReadDto, RenameGroupDto } from "./conversations.dto";
import { ConversationsService } from "./conversations.service";

@Controller("conversations")
@UseGuards(JwtAuthGuard)
export class ConversationsController {
  constructor(private readonly conversations: ConversationsService) {}
  @Get() list(@CurrentUser() user: AuthUser) { return this.conversations.list(user.sub); }
  @Post("direct") direct(@CurrentUser() user: AuthUser, @Body() dto: CreateDirectDto) { return this.conversations.createDirect(user.sub, dto.userId); }
  @Post("group") group(@CurrentUser() user: AuthUser, @Body() dto: CreateGroupDto) { return this.conversations.createGroup(user.sub, dto.name, dto.memberIds); }
  @Patch(":id") rename(@Param("id") id: string, @CurrentUser() user: AuthUser, @Body() dto: RenameGroupDto) { return this.conversations.rename(id, user.sub, dto.name); }
  @Post(":id/members") add(@Param("id") id: string, @CurrentUser() user: AuthUser, @Body() dto: MemberDto) { return this.conversations.addMember(id, user.sub, dto.userId); }
  @Delete(":id/members/:userId") remove(@Param("id") id: string, @Param("userId") memberId: string, @CurrentUser() user: AuthUser) { return this.conversations.removeMember(id, user.sub, memberId); }
  @Post(":id/leave") leave(@Param("id") id: string, @CurrentUser() user: AuthUser) { return this.conversations.leave(id, user.sub); }
  @Post(":id/read") read(@Param("id") id: string, @CurrentUser() user: AuthUser, @Body() dto: ReadDto) { return this.conversations.markRead(id, user.sub, dto.messageId); }
  @Get(":id/keys/latest") latestKey(@Param("id") id: string, @CurrentUser() user: AuthUser) { return this.conversations.latestKey(id, user.sub); }
  @Get(":id/keys/:version") key(@Param("id") id: string, @Param("version", ParseIntPipe) version: number, @CurrentUser() user: AuthUser) { return this.conversations.key(id, user.sub, version); }
  @Post(":id/keys") createKey(@Param("id") id: string, @CurrentUser() user: AuthUser, @Body() dto: CreateConversationKeyDto) { return this.conversations.createKey(id, user.sub, dto.envelopes); }
}
