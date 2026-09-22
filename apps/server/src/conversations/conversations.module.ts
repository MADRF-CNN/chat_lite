import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { ConversationsController } from "./conversations.controller";
import { ConversationsService } from "./conversations.service";
import { RealtimeModule } from "../realtime/realtime.module";

@Module({ imports: [AuthModule, RealtimeModule], controllers: [ConversationsController], providers: [ConversationsService], exports: [ConversationsService] })
export class ConversationsModule {}
