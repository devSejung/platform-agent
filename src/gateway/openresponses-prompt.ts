import {
  buildAgentMessageFromConversationEntries,
  type ConversationEntry,
  IMAGE_ONLY_USER_MESSAGE,
} from "./agent-prompt.js";
import type { ContentPart, ItemParam } from "./open-responses.schema.js";

const FILE_ONLY_USER_MESSAGE = "User sent file(s) with no text.";

function extractTextContent(content: string | ContentPart[]): string {
  if (typeof content === "string") {
    return content;
  }
  return content
    .map((part) => {
      if (part.type === "input_text") {
        return part.text;
      }
      if (part.type === "output_text") {
        return part.text;
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function hasImageContent(content: string | ContentPart[]): boolean {
  return typeof content !== "string" && content.some((part) => part.type === "input_image");
}

function hasFileContent(content: string | ContentPart[]): boolean {
  return typeof content !== "string" && content.some((part) => part.type === "input_file");
}

function placeholderForActiveTurn(content: string | ContentPart[]): string {
  if (hasImageContent(content)) {
    return IMAGE_ONLY_USER_MESSAGE;
  }
  if (hasFileContent(content)) {
    return FILE_ONLY_USER_MESSAGE;
  }
  return "";
}

function findActiveUserMessageIndex(input: ItemParam[]): number {
  for (let i = input.length - 1; i >= 0; i -= 1) {
    const item = input[i];
    if (item?.type === "message" && item.role === "user") {
      return i;
    }
  }
  return -1;
}

export function buildAgentPrompt(input: string | ItemParam[]): {
  message: string;
  extraSystemPrompt?: string;
} {
  if (typeof input === "string") {
    return { message: input };
  }

  const systemParts: string[] = [];
  const conversationEntries: ConversationEntry[] = [];
  const activeUserMessageIndex = findActiveUserMessageIndex(input);

  for (const [i, item] of input.entries()) {
    if (item.type === "message") {
      const content = extractTextContent(item.content).trim();
      const body =
        content ||
        (item.role === "user" && i === activeUserMessageIndex
          ? placeholderForActiveTurn(item.content)
          : "");
      if (!body) {
        continue;
      }

      if (item.role === "system" || item.role === "developer") {
        systemParts.push(body);
        continue;
      }

      const normalizedRole = item.role === "assistant" ? "assistant" : "user";
      const sender = normalizedRole === "assistant" ? "Assistant" : "User";

      conversationEntries.push({
        role: normalizedRole,
        entry: { sender, body },
      });
    } else if (item.type === "function_call_output") {
      conversationEntries.push({
        role: "tool",
        entry: { sender: `Tool:${item.call_id}`, body: item.output },
      });
    }
    // Skip reasoning and item_reference for prompt building (Phase 1)
  }

  const message = buildAgentMessageFromConversationEntries(conversationEntries);

  return {
    message,
    extraSystemPrompt: systemParts.length > 0 ? systemParts.join("\n\n") : undefined,
  };
}
