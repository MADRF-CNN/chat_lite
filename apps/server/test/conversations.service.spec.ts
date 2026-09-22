import { BadRequestException } from "@nestjs/common";
import { ConversationsService } from "../src/conversations/conversations.service";

describe("ConversationsService", () => {
  it("rejects a direct conversation with self", async () => {
    const service = new ConversationsService({} as never);
    await expect(service.createDirect("same", "same")).rejects.toBeInstanceOf(BadRequestException);
  });

  it("deduplicates group member ids and includes owner", async () => {
    const prisma = {
      user: { count: jest.fn().mockResolvedValue(3) },
      conversation: { create: jest.fn().mockResolvedValue({ id: "group" }) },
    };
    const service = new ConversationsService(prisma as never);
    await service.createGroup("owner", "Team", ["one", "one", "two"]);
    expect(prisma.conversation.create.mock.calls[0][0].data.members.create).toHaveLength(3);
  });
});
