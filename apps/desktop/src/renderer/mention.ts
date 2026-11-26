import type { ConversationDto, UserSummary } from "@chat-lite/shared";

const ALL_MENTION_TOKENS = new Set(["all", "所有人", "全体成员", "全体"]);

function isBoundaryBefore(text: string, index: number): boolean {
  if (index <= 0) return true;
  return !/[a-zA-Z0-9._+-]/.test(text[index - 1]!);
}

function isTokenAfterValid(text: string, endIndex: number, isAsciiToken: boolean): boolean {
  if (endIndex >= text.length) return true;
  if (isAsciiToken) return !/[a-zA-Z0-9_-]/.test(text[endIndex]!);
  return true;
}

export type MentionSpan = {
  start: number;
  end: number;
  raw: string;
  target: "me" | "all" | "other";
};

export type MentionCandidate = {
  token: string;
  label: string;
  sublabel: string;
};

export function findMentionSpans(
  text: string,
  me: UserSummary,
  members: UserSummary[] = [],
): MentionSpan[] {
  if (!text || !text.includes("@")) return [];

  const tokens: Array<{ token: string; target: "me" | "all" | "other" }> = [];
  for (const allTok of ALL_MENTION_TOKENS) tokens.push({ token: allTok, target: "all" });

  const allUsers = members.some((m) => m.id === me.id) ? members : [...members, me];
  for (const user of allUsers) {
    const target: "me" | "other" = user.id === me.id ? "me" : "other";
    if (user.username) tokens.push({ token: user.username, target });
    if (user.displayName && user.displayName.toLowerCase() !== user.username.toLowerCase()) {
      tokens.push({ token: user.displayName, target });
    }
  }
  tokens.sort((a, b) => b.token.length - a.token.length);

  const spans: MentionSpan[] = [];
  let i = 0;
  while (i < text.length) {
    const atIdx = text.indexOf("@", i);
    if (atIdx === -1) break;
    if (!isBoundaryBefore(text, atIdx)) {
      i = atIdx + 1;
      continue;
    }

    const rest = text.slice(atIdx + 1);
    let matched: MentionSpan | null = null;
    for (const candidate of tokens) {
      const len = candidate.token.length;
      if (rest.length < len) continue;
      if (rest.slice(0, len).toLowerCase() === candidate.token.toLowerCase()) {
        const isAscii = /^[a-zA-Z0-9_-]+$/.test(candidate.token);
        if (isTokenAfterValid(text, atIdx + 1 + len, isAscii)) {
          matched = { start: atIdx, end: atIdx + 1 + len, raw: text.slice(atIdx, atIdx + 1 + len), target: candidate.target };
          break;
        }
      }
    }

    if (matched) {
      spans.push(matched);
      i = matched.end;
    } else {
      i = atIdx + 1;
    }
  }
  return spans;
}

export function isMentioningMe(
  text: string | null | undefined,
  me: UserSummary,
  conversation?: ConversationDto,
): boolean {
  if (!text || !text.includes("@")) return false;
  if (conversation && conversation.type !== "GROUP") return false;
  return findMentionSpans(text, me, conversation?.members ?? []).some((s) => s.target === "me" || s.target === "all");
}

export function extractMentionQuery(
  text: string,
  caretPos: number,
  conversation?: ConversationDto,
  meId?: string,
): { start: number; end: number; candidates: MentionCandidate[] } | null {
  if (!conversation || conversation.type !== "GROUP") return null;
  const before = text.slice(0, caretPos);
  const match = before.match(/(^|[\s\u4e00-\u9fff])@([^\s@]*)$/);
  if (!match) return null;

  const query = match[2]!.toLowerCase();
  const start = caretPos - match[2]!.length - 1;
  const allCandidates: MentionCandidate[] = [
    { token: "all", label: "所有人", sublabel: "@all" },
    ...conversation.members
      .filter((member) => member.id !== meId)
      .map((member) => ({
        token: member.username,
        label: member.displayName,
        sublabel: `@${member.username}`,
      })),
  ];

  const candidates = allCandidates.filter(
    (item) =>
      item.token.toLowerCase().includes(query) ||
      item.label.toLowerCase().includes(query),
  );
  if (!candidates.length) return null;
  return { start, end: caretPos, candidates };
}
