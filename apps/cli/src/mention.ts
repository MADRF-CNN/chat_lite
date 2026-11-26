import type { ConversationDto, UserSummary } from "@chat-lite/shared";
import { c } from "./color";

const ALL_MENTION_TOKENS = new Set(["all", "所有人", "全体成员", "全体"]);

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isBoundaryBefore(text: string, index: number): boolean {
  if (index <= 0) return true;
  const prev = text[index - 1]!;
  // Do not match inside email addresses (e.g. alice@gmail.com) or identifiers
  return !/[a-zA-Z0-9._+-]/.test(prev);
}

function isTokenAfterValid(text: string, endIndex: number, isAsciiToken: boolean): boolean {
  if (endIndex >= text.length) return true;
  const next = text[endIndex]!;
  if (isAsciiToken) {
    // Avoid partial prefix match on ASCII usernames (e.g. @al matching inside @alice)
    return !/[a-zA-Z0-9_-]/.test(next);
  }
  return true;
}

export type MentionSpan = {
  start: number;
  end: number;
  raw: string;
  target: "me" | "all" | "other";
};

export function findMentionSpans(
  text: string,
  me: UserSummary,
  members: UserSummary[] = [],
): MentionSpan[] {
  if (!text || !text.includes("@")) return [];

  const memberTokens: Array<{ token: string; target: "me" | "all" | "other" }> = [];
  for (const allTok of ALL_MENTION_TOKENS) {
    memberTokens.push({ token: allTok, target: "all" });
  }

  const allUsers = members.some((m) => m.id === me.id) ? members : [...members, me];
  for (const user of allUsers) {
    const target: "me" | "other" = user.id === me.id ? "me" : "other";
    if (user.username) memberTokens.push({ token: user.username, target });
    if (user.displayName && user.displayName.toLowerCase() !== user.username.toLowerCase()) {
      memberTokens.push({ token: user.displayName, target });
    }
  }

  // Sort longest tokens first so multi-char display names match before shorter prefixes
  memberTokens.sort((a, b) => b.token.length - a.token.length);

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

    for (const candidate of memberTokens) {
      const len = candidate.token.length;
      if (rest.length < len) continue;
      if (rest.slice(0, len).toLowerCase() === candidate.token.toLowerCase()) {
        const isAscii = /^[a-zA-Z0-9_-]+$/.test(candidate.token);
        if (isTokenAfterValid(text, atIdx + 1 + len, isAscii)) {
          matched = {
            start: atIdx,
            end: atIdx + 1 + len,
            raw: text.slice(atIdx, atIdx + 1 + len),
            target: candidate.target,
          };
          break;
        }
      }
    }

    // Fallback: highlight generic @word in group chats even if member list wasn't provided
    if (!matched && members.length === 0) {
      const generic = rest.match(/^([a-zA-Z0-9_\u4e00-\u9fff-]{1,32})/);
      if (generic) {
        const token = generic[1]!;
        const lower = token.toLowerCase();
        const target: "me" | "all" | "other" = ALL_MENTION_TOKENS.has(lower)
          ? "all"
          : (lower === me.username.toLowerCase() || lower === me.displayName.toLowerCase())
          ? "me"
          : "other";
        matched = {
          start: atIdx,
          end: atIdx + 1 + token.length,
          raw: text.slice(atIdx, atIdx + 1 + token.length),
          target,
        };
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
  const spans = findMentionSpans(text, me, conversation?.members ?? []);
  return spans.some((span) => span.target === "me" || span.target === "all");
}

export function highlightMentions(
  text: string,
  me: UserSummary,
  members: UserSummary[] = [],
  baseStyler: (segment: string) => string = (segment) => c.brightWhite(segment),
): string {
  const spans = findMentionSpans(text, me, members);
  if (!spans.length) return baseStyler(text);

  let out = "";
  let cursor = 0;
  for (const span of spans) {
    if (span.start > cursor) {
      out += baseStyler(text.slice(cursor, span.start));
    }
    if (span.target === "me" || span.target === "all") {
      out += c.mentionMe(` ${span.raw} `);
    } else {
      out += c.mentionOther(span.raw);
    }
    cursor = span.end;
  }
  if (cursor < text.length) {
    out += baseStyler(text.slice(cursor));
  }
  return out;
}

export function completeGroupMention(
  line: string,
  conversation: ConversationDto | undefined,
  meId: string,
): [string[], string] | null {
  if (!conversation || conversation.type !== "GROUP") return null;
  const match = line.match(/(^|[\s\u4e00-\u9fff])@([^\s@]*)$/);
  if (!match) return null;

  const prefix = line.slice(0, line.length - match[2]!.length - 1);
  const query = match[2]!.toLowerCase();

  const candidates: string[] = ["all"];
  const seen = new Set<string>(["all"]);
  for (const member of conversation.members) {
    if (member.id === meId) continue;
    const uname = member.username;
    if (uname && !seen.has(uname.toLowerCase())) {
      seen.add(uname.toLowerCase());
      candidates.push(uname);
    }
    if (member.displayName && !seen.has(member.displayName.toLowerCase()) && !/\s/.test(member.displayName)) {
      seen.add(member.displayName.toLowerCase());
      candidates.push(member.displayName);
    }
  }

  const hits = candidates
    .filter((item) => item.toLowerCase().startsWith(query))
    .map((item) => `${prefix}@${item} `);

  return [hits, line];
}

// Keep unused helper reference clean
void escapeRegExp;
