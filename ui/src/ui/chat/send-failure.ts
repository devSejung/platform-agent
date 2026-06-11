import type { ChatFailureCode } from "../ui-types.ts";

export type ChatFailurePresentation = {
  code: ChatFailureCode;
  title: string;
  detail: string;
  retryable: boolean;
};

const KNOWN_CODES = new Set<ChatFailureCode>([
  "timeout",
  "rate_limit",
  "overloaded",
  "auth",
  "auth_permanent",
  "billing",
  "format",
  "model_not_found",
  "session_expired",
  "network",
  "unknown",
]);

function normalizeCode(code: unknown, rawMessage: string): ChatFailureCode {
  if (typeof code === "string" && KNOWN_CODES.has(code as ChatFailureCode)) {
    return code as ChatFailureCode;
  }

  const message = rawMessage.toLowerCase();
  if (/429|rate.?limit|too many requests|resource exhausted|throttl/.test(message)) {
    return "rate_limit";
  }
  if (/529|overload|server is busy|capacity/.test(message)) {
    return "overloaded";
  }
  if (/408|504|timed? ?out|timeout|etimedout/.test(message)) {
    return "timeout";
  }
  if (/auth|unauthori[sz]ed|token|device identity|origin not allowed|forbidden/.test(message)) {
    return "auth";
  }
  if (/invalid request|validation|unsupported format|bad request/.test(message)) {
    return "format";
  }
  if (/network|fetch failed|connection (?:reset|closed|failed)|econn/.test(message)) {
    return "network";
  }
  return "unknown";
}

export function describeChatFailure(
  code: unknown,
  rawMessage = "",
  localizedKo = false,
): ChatFailurePresentation {
  const normalized = normalizeCode(code, rawMessage);
  switch (normalized) {
    case "timeout":
      return {
        code: normalized,
        title: localizedKo
          ? "AI 서버가 제한 시간 내에 응답하지 않았습니다."
          : "The AI server did not respond in time.",
        detail: localizedKo
          ? "일시적인 사용량 증가 또는 네트워크 지연일 수 있습니다."
          : "This may be caused by temporary demand or network latency.",
        retryable: true,
      };
    case "rate_limit":
      return {
        code: normalized,
        title: localizedKo
          ? "현재 AI 요청이 많아 잠시 처리할 수 없습니다."
          : "The AI service is receiving too many requests.",
        detail: localizedKo ? "잠시 후 다시 시도해 주세요." : "Please try again shortly.",
        retryable: true,
      };
    case "overloaded":
      return {
        code: normalized,
        title: localizedKo
          ? "AI 서버 사용량이 많아 응답하지 못했습니다."
          : "The AI server is currently overloaded.",
        detail: localizedKo
          ? "잠시 후 다시 시도하면 정상적으로 처리될 수 있습니다."
          : "Trying again shortly may resolve the issue.",
        retryable: true,
      };
    case "network":
      return {
        code: normalized,
        title: localizedKo
          ? "서버와 통신하는 중 연결이 끊겼습니다."
          : "The connection to the server was interrupted.",
        detail: localizedKo
          ? "네트워크 연결을 확인한 뒤 다시 시도해 주세요."
          : "Check your network connection and try again.",
        retryable: true,
      };
    case "auth":
    case "auth_permanent":
      return {
        code: normalized,
        title: localizedKo
          ? "AI 서버 인증에 문제가 발생했습니다."
          : "The AI server could not authenticate this request.",
        detail: localizedKo ? "관리자에게 문의해 주세요." : "Contact your administrator.",
        retryable: false,
      };
    case "billing":
      return {
        code: normalized,
        title: localizedKo
          ? "AI 서비스 사용 한도를 확인해야 합니다."
          : "The AI service usage limit needs attention.",
        detail: localizedKo ? "관리자에게 문의해 주세요." : "Contact your administrator.",
        retryable: false,
      };
    case "model_not_found":
      return {
        code: normalized,
        title: localizedKo
          ? "선택한 AI 모델을 사용할 수 없습니다."
          : "The selected AI model is unavailable.",
        detail: localizedKo
          ? "다른 모델을 선택하거나 관리자에게 문의해 주세요."
          : "Choose another model or contact your administrator.",
        retryable: false,
      };
    case "session_expired":
      return {
        code: normalized,
        title: localizedKo ? "채팅 세션이 만료되었습니다." : "This chat session has expired.",
        detail: localizedKo
          ? "새 채팅에서 다시 요청해 주세요."
          : "Start a new chat and send the request again.",
        retryable: false,
      };
    case "format":
      return {
        code: normalized,
        title: localizedKo
          ? "요청을 처리할 수 없는 형식입니다."
          : "The request could not be processed in its current format.",
        detail: localizedKo
          ? "메시지나 첨부파일을 확인한 뒤 다시 보내 주세요."
          : "Check the message or attachments and send it again.",
        retryable: false,
      };
    default:
      return {
        code: "unknown",
        title: localizedKo
          ? "AI 응답을 받는 중 문제가 발생했습니다."
          : "A problem occurred while waiting for the AI response.",
        detail: localizedKo
          ? "문제가 계속되면 관리자에게 문의해 주세요."
          : "Contact your administrator if the problem continues.",
        retryable: true,
      };
  }
}
