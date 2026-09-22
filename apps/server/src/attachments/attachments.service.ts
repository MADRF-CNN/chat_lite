import { BadRequestException, ForbiddenException, Injectable, NotFoundException, OnModuleInit } from "@nestjs/common";
import { CreateBucketCommand, GetObjectCommand, HeadBucketCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class AttachmentsService implements OnModuleInit {
  private readonly bucket = process.env.S3_BUCKET ?? "chat-images";
  private readonly s3 = new S3Client({
    endpoint: process.env.S3_ENDPOINT,
    region: process.env.S3_REGION ?? "us-east-1",
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== "false",
    credentials: process.env.S3_ACCESS_KEY && process.env.S3_SECRET_KEY ? {
      accessKeyId: process.env.S3_ACCESS_KEY,
      secretAccessKey: process.env.S3_SECRET_KEY,
    } : undefined,
  });

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    try {
      await this.s3.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch {
      try { await this.s3.send(new CreateBucketCommand({ Bucket: this.bucket })); } catch { /* storage may initialize later */ }
    }
  }

  async upload(userId: string, files: Express.Multer.File[], encrypted = false) {
    const file = files.find((item) => item.fieldname === "file");
    if (!file) throw new BadRequestException("请选择图片");
    if (!encrypted) throw new BadRequestException("客户端版本过旧，服务器只接受端到端加密图片");
    const thumbnail = files.find((item) => item.fieldname === "thumbnail");
    if (!thumbnail) throw new BadRequestException("缺少加密缩略图");
    if (file.size > 10 * 1024 * 1024 + 32 || thumbnail.size > 2 * 1024 * 1024) throw new BadRequestException("加密图片过大");
    const id = randomUUID();
    const objectKey = `encrypted/original/${id}.bin`;
    const thumbnailKey = `encrypted/thumbnail/${id}.bin`;
    await Promise.all([
      this.s3.send(new PutObjectCommand({ Bucket: this.bucket, Key: objectKey, Body: file.buffer, ContentType: "application/octet-stream" })),
      this.s3.send(new PutObjectCommand({ Bucket: this.bucket, Key: thumbnailKey, Body: thumbnail.buffer, ContentType: "application/octet-stream" })),
    ]);
    return this.prisma.attachment.create({
      data: { id, objectKey, thumbnailKey, originalName: "encrypted", mimeType: "application/octet-stream", size: file.size, width: 0, height: 0, uploadedById: userId, encrypted: true },
      select: { id: true, encrypted: true },
    });
  }

  async download(userId: string, id: string, variant: "original" | "thumbnail") {
    const attachment = await this.prisma.attachment.findUnique({
      where: { id }, include: { message: { select: { conversation: { select: { members: { where: { userId }, select: { userId: true } } } } } } },
    });
    if (!attachment) throw new NotFoundException("图片不存在");
    const isMember = Boolean(attachment.message?.conversation.members.length);
    if ((!attachment.message && attachment.uploadedById !== userId) || (attachment.message && !isMember)) throw new ForbiddenException();
    const object = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: variant === "thumbnail" ? attachment.thumbnailKey : attachment.objectKey }));
    if (!object.Body) throw new NotFoundException("图片文件不存在");
    return {
      body: object.Body,
      contentType: attachment.encrypted ? "application/octet-stream" : variant === "thumbnail" ? "image/webp" : attachment.mimeType,
      filename: attachment.encrypted ? `${attachment.id}.bin` : attachment.originalName,
    };
  }
}
