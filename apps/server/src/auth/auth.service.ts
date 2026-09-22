import { BadRequestException, Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { createHash, randomBytes } from "node:crypto";
import * as argon2 from "argon2";
import { PrismaService } from "../prisma/prisma.service";
import { LoginDto, RegisterDto } from "./auth.dto";

const hashToken = (value: string) => createHash("sha256").update(value).digest("hex");
const publicUser = (user: { id: string; username: string; displayName: string }) => ({
  id: user.id,
  username: user.username,
  displayName: user.displayName,
});

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService, private readonly jwt: JwtService) {}

  async register(dto: RegisterDto) {
    const username = dto.username.trim().toLowerCase();
    if (!/^[a-z0-9_.-]+$/.test(username)) {
      throw new BadRequestException("用户名只能包含字母、数字、下划线、点和连字符");
    }
    const inviteHash = hashToken(dto.inviteCode.trim());
    const user = await this.prisma.$transaction(async (tx) => {
      const invite = await tx.inviteCode.findUnique({ where: { codeHash: inviteHash } });
      if (!invite || invite.usedCount >= invite.maxUses || (invite.expiresAt && invite.expiresAt <= new Date())) {
        throw new BadRequestException("邀请码无效或已过期");
      }
      if (await tx.user.findUnique({ where: { username } })) throw new BadRequestException("用户名已存在");
      const created = await tx.user.create({
        data: { username, displayName: dto.displayName.trim(), passwordHash: await argon2.hash(dto.password) },
      });
      await tx.inviteCode.update({ where: { id: invite.id }, data: { usedCount: { increment: 1 } } });
      return created;
    }, { isolationLevel: "Serializable" });
    return this.issueTokens(user);
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({ where: { username: dto.username.trim().toLowerCase() } });
    if (!user || !(await argon2.verify(user.passwordHash, dto.password))) {
      throw new UnauthorizedException("用户名或密码错误");
    }
    return this.issueTokens(user);
  }

  async refresh(rawToken: string) {
    let payload: { sub: string };
    try {
      payload = await this.jwt.verifyAsync(rawToken, { secret: process.env.JWT_REFRESH_SECRET });
    } catch {
      throw new UnauthorizedException("刷新令牌无效");
    }
    const stored = await this.prisma.refreshToken.findUnique({ where: { tokenHash: hashToken(rawToken) }, include: { user: true } });
    if (!stored || stored.revokedAt || stored.expiresAt <= new Date() || stored.userId !== payload.sub) {
      throw new UnauthorizedException("刷新令牌已失效");
    }
    await this.prisma.refreshToken.update({ where: { id: stored.id }, data: { revokedAt: new Date() } });
    return this.issueTokens(stored.user);
  }

  async logout(rawToken: string) {
    await this.prisma.refreshToken.updateMany({ where: { tokenHash: hashToken(rawToken), revokedAt: null }, data: { revokedAt: new Date() } });
  }

  private async issueTokens(user: { id: string; username: string; displayName: string; role: "USER" | "ADMIN" }) {
    const payload = { sub: user.id, username: user.username, role: user.role };
    const accessToken = await this.jwt.signAsync(payload, {
      secret: process.env.JWT_ACCESS_SECRET,
      expiresIn: (process.env.ACCESS_TOKEN_TTL ?? "15m") as never,
    });
    const days = Number(process.env.REFRESH_TOKEN_TTL_DAYS ?? 30);
    const refreshToken = await this.jwt.signAsync({ sub: user.id, nonce: randomBytes(16).toString("hex") }, {
      secret: process.env.JWT_REFRESH_SECRET,
      expiresIn: `${days}d`,
    });
    await this.prisma.refreshToken.create({
      data: { userId: user.id, tokenHash: hashToken(refreshToken), expiresAt: new Date(Date.now() + days * 86_400_000) },
    });
    return { accessToken, refreshToken, user: publicUser(user) };
  }
}
