import { BadRequestException, ForbiddenException, Injectable, NotFoundException, OnModuleInit } from "@nestjs/common";
import { CreateBucketCommand, GetObjectCommand, HeadBucketCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { CliReleaseManifest, CliUpdateBundle } from "@chat-lite/shared";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { PrismaService } from "../prisma/prisma.service";

const VERSION_REGEX = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const LATEST_KEY = "releases/cli/latest.json";

function bundleKey(version: string) {
  return `releases/cli/bundle-${version}.json.gz`;
}

export function isAllowedBundleFilePath(relPath: string): boolean {
  if (!relPath || relPath.includes("..") || relPath.includes("\\") || relPath.startsWith("/")) return false;
  if (relPath === "app/package.json" || relPath === "使用手册.md") return true;
  return /^app\/dist\/[A-Za-z0-9_.-]+\.js$/.test(relPath);
}

async function bodyToBuffer(body: unknown): Promise<Buffer> {
  const candidate = body as {
    transformToByteArray?: () => Promise<Uint8Array>;
    [Symbol.asyncIterator]?: () => AsyncIterator<Buffer | Uint8Array>;
  };
  if (candidate.transformToByteArray) {
    return Buffer.from(await candidate.transformToByteArray());
  }
  const chunks: Buffer[] = [];
  for await (const chunk of candidate as AsyncIterable<Buffer | Uint8Array>) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

@Injectable()
export class ReleasesService implements OnModuleInit {
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

  async getLatestCli(): Promise<{ latest: CliReleaseManifest | null }> {
    try {
      const object = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: LATEST_KEY }));
      if (!object.Body) return { latest: null };
      const raw = (await bodyToBuffer(object.Body)).toString("utf8");
      const manifest = JSON.parse(raw) as CliReleaseManifest;
      if (!manifest?.version || !manifest?.sha256) return { latest: null };
      return { latest: manifest };
    } catch {
      return { latest: null };
    }
  }

  async downloadCliBundle(version: string) {
    if (!VERSION_REGEX.test(version)) throw new BadRequestException("版本号格式无效");
    try {
      const object = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: bundleKey(version) }));
      if (!object.Body) throw new NotFoundException("找不到该版本的更新包");
      return {
        body: object.Body,
        filename: `chat-lite-cli-${version}.json.gz`,
      };
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      throw new NotFoundException("找不到该版本的更新包");
    }
  }

  async publishCli(
    userId: string,
    jwtRole: "USER" | "ADMIN",
    file: Express.Multer.File | undefined,
    meta: { version?: string; depsHash?: string; notes?: string; minNodeMajor?: string },
  ): Promise<CliReleaseManifest> {
    let isAdmin = jwtRole === "ADMIN";
    if (!isAdmin) {
      const dbUser = await this.prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
      isAdmin = dbUser?.role === "ADMIN";
    }
    if (!isAdmin) throw new ForbiddenException("仅管理员可以发布 CLI 更新");
    if (!file || !file.buffer?.length) throw new BadRequestException("缺少更新包文件（bundle）");
    if (file.size > 5 * 1024 * 1024) throw new BadRequestException("更新包不能超过 5MB");

    const version = (meta.version ?? "").trim();
    if (!VERSION_REGEX.test(version)) throw new BadRequestException("版本号格式无效，例如 0.1.3");
    const depsHash = (meta.depsHash ?? "").trim();
    if (!/^[a-f0-9]{16,64}$/i.test(depsHash)) throw new BadRequestException("缺少有效的 depsHash");

    let parsed: CliUpdateBundle;
    try {
      const jsonText = gunzipSync(file.buffer).toString("utf8");
      parsed = JSON.parse(jsonText) as CliUpdateBundle;
    } catch {
      throw new BadRequestException("更新包不是有效的 gzip JSON 格式");
    }

    if (parsed.version !== version) throw new BadRequestException("更新包内版本号与参数不一致");
    const fileEntries = Object.entries(parsed.files ?? {});
    if (!fileEntries.length) throw new BadRequestException("更新包不包含任何文件");
    if (!parsed.files["app/dist/index.js"]) throw new BadRequestException("更新包缺少 app/dist/index.js");
    for (const [relPath, content] of fileEntries) {
      if (!isAllowedBundleFilePath(relPath)) throw new BadRequestException(`更新包包含不允许的路径：${relPath}`);
      if (typeof content !== "string") throw new BadRequestException(`文件内容格式错误：${relPath}`);
    }

    const sha256 = createHash("sha256").update(file.buffer).digest("hex");
    const minNodeMajor = Number.parseInt(meta.minNodeMajor ?? "20", 10);
    const manifest: CliReleaseManifest = {
      version,
      publishedAt: new Date().toISOString(),
      notes: (meta.notes ?? parsed.notes ?? "").trim() || undefined,
      sha256,
      size: file.buffer.length,
      depsHash,
      minNodeMajor: Number.isInteger(minNodeMajor) && minNodeMajor >= 18 ? minNodeMajor : 20,
    };

    await Promise.all([
      this.s3.send(new PutObjectCommand({
        Bucket: this.bucket,
        Key: bundleKey(version),
        Body: file.buffer,
        ContentType: "application/gzip",
      })),
      this.s3.send(new PutObjectCommand({
        Bucket: this.bucket,
        Key: LATEST_KEY,
        Body: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8"),
        ContentType: "application/json",
      })),
    ]);

    return manifest;
  }
}
