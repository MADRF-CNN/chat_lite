import { Body, Controller, Get, Put, Query, UseGuards } from "@nestjs/common";
import { IsString, Length } from "class-validator";
import { PrismaService } from "../prisma/prisma.service";
import { CurrentUser, AuthUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";

class PublicKeyDto {
  @IsString() @Length(100, 8000) publicKey!: string;
}

@Controller("users")
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly prisma: PrismaService) {}

  @Get("search")
  search(@CurrentUser() user: AuthUser, @Query("q") query = "") {
    const q = query.trim();
    if (q.length < 2) return [];
    return this.prisma.user.findMany({
      where: {
        id: { not: user.sub },
        OR: [
          { username: { contains: q.toLowerCase(), mode: "insensitive" } },
          { displayName: { contains: q, mode: "insensitive" } },
        ],
      },
      select: { id: true, username: true, displayName: true },
      take: 20,
      orderBy: { username: "asc" },
    });
  }

  @Get("keys")
  async keys(@CurrentUser() user: AuthUser, @Query("ids") ids = "") {
    const requested = [...new Set(ids.split(",").filter(Boolean))].slice(0, 100);
    if (!requested.length) return [];
    const sharedConversation = await this.prisma.conversation.findFirst({
      where: { AND: [{ members: { some: { userId: user.sub } } }, { members: { some: { userId: { in: requested } } } }] },
      select: { id: true },
    });
    if (!sharedConversation && requested.some((id) => id !== user.sub)) return [];
    return this.prisma.user.findMany({ where: { id: { in: requested } }, select: { id: true, publicKey: true } });
  }

  @Put("me/public-key")
  setPublicKey(@CurrentUser() user: AuthUser, @Body() dto: PublicKeyDto) {
    return this.prisma.user.update({ where: { id: user.sub }, data: { publicKey: dto.publicKey }, select: { id: true, publicKey: true } });
  }
}
