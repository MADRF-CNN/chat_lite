import { IsInt, IsOptional, IsString, Length, Max, Min } from "class-validator";

export class RegisterDto {
  @IsString() @Length(3, 32) username!: string;
  @IsString() @Length(1, 50) displayName!: string;
  @IsString() @Length(8, 128) password!: string;
  @IsString() @Length(6, 128) inviteCode!: string;
}

export class LoginDto {
  @IsString() username!: string;
  @IsString() password!: string;
}

export class RefreshDto {
  @IsString() refreshToken!: string;
}

export class InviteOptionsDto {
  @IsInt() @Min(1) @Max(100) @IsOptional() maxUses = 1;
}
