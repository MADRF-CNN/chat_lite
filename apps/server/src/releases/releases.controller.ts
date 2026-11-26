import { Body, Controller, Get, Param, Post, Res, UploadedFile, UseGuards, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";
import { AuthUser, CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { ReleasesService } from "./releases.service";

@Controller("releases")
@UseGuards(JwtAuthGuard)
export class ReleasesController {
  constructor(private readonly releases: ReleasesService) {}

  @Get("cli/latest")
  latestCli() {
    return this.releases.getLatestCli();
  }

  @Get("cli/bundle/:version")
  async downloadCli(@Param("version") version: string, @Res() response: Response) {
    const result = await this.releases.downloadCliBundle(version);
    response.setHeader("Content-Type", "application/gzip");
    response.setHeader("Content-Disposition", `attachment; filename="${result.filename}"`);
    const body = result.body as { pipe?: (target: Response) => void; transformToByteArray?: () => Promise<Uint8Array> };
    if (body.pipe) body.pipe(response);
    else response.end(Buffer.from(await body.transformToByteArray!()));
  }

  @Post("cli")
  @UseInterceptors(FileInterceptor("bundle", { limits: { fileSize: 5 * 1024 * 1024, files: 1 } }))
  publishCli(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body("version") version?: string,
    @Body("depsHash") depsHash?: string,
    @Body("notes") notes?: string,
    @Body("minNodeMajor") minNodeMajor?: string,
  ) {
    return this.releases.publishCli(user.sub, user.role, file, { version, depsHash, notes, minNodeMajor });
  }
}
