const EMPLOYEE_VOC_PATH = "/employee/voc";
const MAX_VOC_TITLE_CHARS = 200;
const MAX_VOC_BODY_CHARS = 8000;
const EMPLOYEE_VOC_AUTO_CLOSE_MS = 2000;

const autoCloseTimers = new WeakMap<EmployeeVocState, number>();

export type EmployeeVocState = {
  employeeMode: boolean;
  employeeVocModalOpen: boolean;
  employeeVocTitle: string;
  employeeVocBody: string;
  employeeVocSubmitting: boolean;
  employeeVocError: string | null;
  employeeVocResult: { issueKey: string; issueUrl: string } | null;
  settings: { locale?: string | null };
};

function isEnglish(state: EmployeeVocState): boolean {
  return state.settings.locale === "en";
}

function trimText(value: string): string {
  return value.replace(/\r\n/g, "\n").trim();
}

function clearAutoCloseTimer(state: EmployeeVocState) {
  const timer = autoCloseTimers.get(state);
  if (typeof timer === "number") {
    window.clearTimeout(timer);
    autoCloseTimers.delete(state);
  }
}

export async function submitEmployeeVoc(state: EmployeeVocState) {
  if (!state.employeeMode || state.employeeVocSubmitting) {
    return;
  }

  const english = isEnglish(state);
  const title = trimText(state.employeeVocTitle);
  const body = trimText(state.employeeVocBody);
  const confirmMessage = english
    ? "Would you like to register this VOC?"
    : "등록하시겠습니까?";

  if (!title) {
    state.employeeVocError = english ? "Please enter a title." : "제목을 입력해주세요.";
    return;
  }
  if (!body) {
    state.employeeVocError = english ? "Please enter details." : "내용을 입력해주세요.";
    return;
  }
  if (title.length > MAX_VOC_TITLE_CHARS) {
    state.employeeVocError = english
      ? `Title must be ${MAX_VOC_TITLE_CHARS} characters or fewer.`
      : `제목은 ${MAX_VOC_TITLE_CHARS}자 이하로 입력해주세요.`;
    return;
  }
  if (body.length > MAX_VOC_BODY_CHARS) {
    state.employeeVocError = english
      ? `Details must be ${MAX_VOC_BODY_CHARS} characters or fewer.`
      : `내용은 ${MAX_VOC_BODY_CHARS}자 이하로 입력해주세요.`;
    return;
  }

  if (typeof window !== "undefined" && typeof window.confirm === "function") {
    const confirmed = window.confirm(confirmMessage);
    if (!confirmed) {
      return;
    }
  }

  clearAutoCloseTimer(state);
  state.employeeVocSubmitting = true;
  state.employeeVocError = null;
  state.employeeVocResult = null;

  try {
    const response = await fetch(EMPLOYEE_VOC_PATH, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      credentials: "include",
      body: JSON.stringify({ title, body }),
    });
    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    if (
      !response.ok ||
      !payload ||
      typeof payload !== "object" ||
      (payload as { ok?: unknown }).ok !== true ||
      typeof (payload as { issueKey?: unknown }).issueKey !== "string" ||
      typeof (payload as { issueUrl?: unknown }).issueUrl !== "string"
    ) {
      const fallback = english ? "Failed to submit VOC." : "VOC 등록에 실패했습니다.";
      const message =
        payload &&
        typeof payload === "object" &&
        typeof (payload as { error?: unknown }).error === "string"
          ? (payload as { error: string }).error
          : fallback;
      throw new Error(message);
    }
    state.employeeVocTitle = "";
    state.employeeVocBody = "";
    state.employeeVocResult = {
      issueKey: (payload as { issueKey: string }).issueKey,
      issueUrl: (payload as { issueUrl: string }).issueUrl,
    };
    if (typeof window !== "undefined") {
      const timer = window.setTimeout(() => {
        state.employeeVocModalOpen = false;
        autoCloseTimers.delete(state);
      }, EMPLOYEE_VOC_AUTO_CLOSE_MS);
      autoCloseTimers.set(state, timer);
    }
  } catch (error) {
    state.employeeVocError = error instanceof Error ? error.message : String(error);
  } finally {
    state.employeeVocSubmitting = false;
  }
}
