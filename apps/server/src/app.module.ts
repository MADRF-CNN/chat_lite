import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { AuthModule } from "./auth/auth.module";
import { UsersModule } from "./users/users.module";
import { ConversationsModule } from "./conversations/conversations.module";
import { MessagesModule } from "./messages/messages.module";
import { AttachmentsModule } from "./attachments/attachments.module";
import { PrismaModule } from "./prisma/prisma.module";
import { RealtimeModule } from "./realtime/realtime.module";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: (config) => {
        for (const name of ["DATABASE_URL", "JWT_ACCESS_SECRET", "JWT_REFRESH_SECRET"]) {
          if (!config[name]) throw new Error(`Missing required environment variable: ${name}`);
        }
        if (config.JWT_ACCESS_SECRET.length < 32 || config.JWT_REFRESH_SECRET.length < 32) throw new Error("JWT secrets must be at least 32 characters");
        return config;
      },
    }),
    PrismaModule,
    AuthModule,
    UsersModule,
    ConversationsModule,
    MessagesModule,
    AttachmentsModule,
    RealtimeModule,
  ],
})
export class AppModule {}
