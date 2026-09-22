import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NextFunction, Request, Response } from "express";
import helmet from "helmet";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.getHttpAdapter().getInstance().set("trust proxy", 1);
  app.use(helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
    strictTransportSecurity: { maxAge: 31_536_000, includeSubDomains: true },
  }));
  if (process.env.NODE_ENV === "production" && process.env.ENFORCE_TLS !== "false") {
    app.use((request: Request, response: Response, next: NextFunction) => {
      const forwardedProtocol = request.headers["x-forwarded-proto"];
      if (request.secure || forwardedProtocol === "https") return next();
      response.status(426).json({ message: "生产环境仅接受 HTTPS/WSS 加密连接" });
    });
  }
  const allowedOrigins = (process.env.CLIENT_ORIGIN ?? "http://localhost:5173").split(",").map((item) => item.trim());
  app.enableCors({
    origin: (origin: string | undefined, callback: (error: Error | null, allow?: boolean) => void) =>
      callback(null, !origin || origin === "null" || allowedOrigins.includes(origin)),
    credentials: true,
  });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.setGlobalPrefix("api");
  await app.listen(Number(process.env.PORT ?? 3000));
}

void bootstrap();
