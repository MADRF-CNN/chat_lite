import { createParamDecorator, ExecutionContext } from "@nestjs/common";

export type AuthUser = { sub: string; username: string; role: "USER" | "ADMIN" };

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthUser => context.switchToHttp().getRequest().user,
);
