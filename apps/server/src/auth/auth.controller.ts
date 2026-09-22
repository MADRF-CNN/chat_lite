import { Body, Controller, Post } from "@nestjs/common";
import { AuthService } from "./auth.service";
import { LoginDto, RefreshDto, RegisterDto } from "./auth.dto";

@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}
  @Post("register") register(@Body() dto: RegisterDto) { return this.auth.register(dto); }
  @Post("login") login(@Body() dto: LoginDto) { return this.auth.login(dto); }
  @Post("refresh") refresh(@Body() dto: RefreshDto) { return this.auth.refresh(dto.refreshToken); }
  @Post("logout") async logout(@Body() dto: RefreshDto) { await this.auth.logout(dto.refreshToken); return { ok: true }; }
}
