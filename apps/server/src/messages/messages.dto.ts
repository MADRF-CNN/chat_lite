import { ArrayMaxSize, IsArray, IsInt, IsOptional, IsString, Length, Max, Min } from "class-validator";

export class SendMessageDto {
  @IsString() @Length(8, 100) clientId!: string;
  @IsString() @Length(1, 4000) @IsOptional() text?: string;
  @IsString() @Length(16, 100_000) @IsOptional() ciphertext?: string;
  @IsString() @Length(16, 100) @IsOptional() nonce?: string;
  @IsInt() @Min(1) @Max(1_000_000) @IsOptional() keyVersion?: number;
  @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) @IsOptional() attachmentIds: string[] = [];
}
