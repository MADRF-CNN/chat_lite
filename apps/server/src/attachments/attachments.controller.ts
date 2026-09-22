import { Body, Controller, Get, Param, Post, Res, UploadedFiles, UseGuards, UseInterceptors } from "@nestjs/common";
import { AnyFilesInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";
import { AuthUser, CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { AttachmentsService } from "./attachments.service";

@Controller("attachments")
@UseGuards(JwtAuthGuard)
export class AttachmentsController {
  constructor(private readonly attachments: AttachmentsService) {}

  @Post()
  @UseInterceptors(AnyFilesInterceptor({ limits: { fileSize: 11 * 1024 * 1024, files: 2 } }))
  upload(@CurrentUser() user: AuthUser, @UploadedFiles() files: Express.Multer.File[] = [], @Body("encrypted") encrypted?: string) {
    return this.attachments.upload(user.sub, files, encrypted === "true");
  }

  @Get(":id/:variant")
  async download(@CurrentUser() user: AuthUser, @Param("id") id: string, @Param("variant") variant: string, @Res() response: Response) {
    const result = await this.attachments.download(user.sub, id, variant === "thumbnail" ? "thumbnail" : "original");
    response.setHeader("Content-Type", result.contentType);
    response.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(result.filename)}`);
    const body = result.body as { pipe?: (target: Response) => void; transformToByteArray?: () => Promise<Uint8Array> };
    if (body.pipe) body.pipe(response);
    else response.end(Buffer.from(await body.transformToByteArray!()));
  }
}
