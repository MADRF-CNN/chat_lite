import { PrismaClient } from "@prisma/client";
import { createHash, randomBytes } from "node:crypto";

async function main() {
  const prisma = new PrismaClient();
  const args = process.argv.slice(2).filter((argument) => argument !== "--");
  const maxUses = Math.min(Math.max(Number(args[0] ?? 1), 1), 100);
  const expiresInDays = Number(args[1] ?? 30);
  const code = randomBytes(12).toString("base64url");
  try {
    await prisma.inviteCode.create({
      data: {
        codeHash: createHash("sha256").update(code).digest("hex"),
        maxUses,
        expiresAt: expiresInDays > 0 ? new Date(Date.now() + expiresInDays * 86_400_000) : null,
      },
    });
    console.log(`Invite code: ${code}`);
    console.log(`Max uses: ${maxUses}; expires: ${expiresInDays > 0 ? `${expiresInDays} day(s)` : "never"}`);
  } finally {
    await prisma.$disconnect();
  }
}

void main();
