import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import type { Request } from "express";
import type { AuthUser } from "./current-user.decorator";

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const [scheme, token] = request.headers.authorization?.split(" ") ?? [];
    if (scheme !== "Bearer" || !token) throw new UnauthorizedException();
    try {
      request.user = await this.jwt.verifyAsync<AuthUser>(token, {
        secret: process.env.JWT_ACCESS_SECRET,
      });
      return true;
    } catch {
      throw new UnauthorizedException();
    }
  }
}
