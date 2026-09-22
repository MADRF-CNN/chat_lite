import { ArrayMaxSize, ArrayMinSize, IsArray, IsString, Length, ValidateNested } from "class-validator";
import { Type } from "class-transformer";

export class CreateDirectDto { @IsString() userId!: string; }

export class CreateGroupDto {
  @IsString() @Length(1, 60) name!: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(99) @IsString({ each: true }) memberIds!: string[];
}

export class RenameGroupDto { @IsString() @Length(1, 60) name!: string; }
export class MemberDto { @IsString() userId!: string; }
export class ReadDto { @IsString() messageId!: string; }

export class KeyEnvelopeDto {
  @IsString() userId!: string;
  @IsString() @Length(100, 16_000) encryptedKey!: string;
}

export class CreateConversationKeyDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => KeyEnvelopeDto)
  envelopes!: KeyEnvelopeDto[];
}
