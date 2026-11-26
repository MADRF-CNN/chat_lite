import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { ReleasesController } from "./releases.controller";
import { ReleasesService } from "./releases.service";

@Module({ imports: [AuthModule], controllers: [ReleasesController], providers: [ReleasesService] })
export class ReleasesModule {}
