import { html, type TemplateResult } from "lit";

type LoginMascotMode = "idle" | "account" | "password";

export type EmployeeLoginMascotRefs = {
  root?: HTMLElement;
  accountInput?: HTMLInputElement;
  passwordInput?: HTMLInputElement;
  mirror?: HTMLElement;
};

const BODY_RANGE_X = 42;
const EYE_RANGE_X = 96;
const EYE_RANGE_Y = 72;
const EYE_RANGE_Y_DOWN = 87;
const LOOK_GAIN = 0.42;

const LOGIN_MASCOT_BODY_PATH = `
  M 307 282
  L 307 339
  L 250 341
  L 250 511
  L 306 511
  L 307 571
  L 360 573
  L 360 678
  L 308 680
  L 308 783
  L 360 784
  L 360 841
  L 308 842
  L 308 969
  L 360 969
  L 360 912
  L 404 911
  L 405 871
  L 448 871
  L 449 912
  L 515 912
  L 517 853
  L 738 853
  L 740 912
  L 806 912
  L 807 871
  L 850 871
  L 852 912
  L 895 912
  L 895 969
  L 947 970
  L 947 842
  L 895 841
  L 895 784
  L 947 783
  L 947 679
  L 895 678
  L 895 573
  L 948 571
  L 949 511
  L 1004 511
  L 1004 340
  L 947 339
  L 947 282
  L 860 282
  L 858 412
  L 806 411
  L 805 340
  L 739 341
  L 739 510
  L 792 512
  L 792 572
  L 835 572
  L 835 612
  L 420 612
  L 420 572
  L 463 572
  L 463 512
  L 515 511
  L 516 341
  L 450 340
  L 449 411
  L 396 412
  L 396 283
  Z
  M 701 673
  L 739 674
  L 738 747
  L 700 746
  Z
  M 517 673
  L 555 674
  L 554 747
  L 516 746
  Z
`;

const installedLoginMascots = new WeakMap<HTMLElement, () => void>();
let activeLoginMascotCleanup: (() => void) | null = null;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function prefersReducedMotion(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

function setMascotVars(
  root: HTMLElement,
  values: { mascotX?: number; eyeX?: number; eyeY?: number; eyeOpen?: number },
) {
  if (values.mascotX != null) {
    root.style.setProperty(
      "--mascot-x",
      `${Math.round(clamp(values.mascotX, -BODY_RANGE_X, BODY_RANGE_X))}px`,
    );
  }
  if (values.eyeX != null) {
    root.style.setProperty(
      "--eye-x",
      `${Math.round(clamp(values.eyeX, -EYE_RANGE_X, EYE_RANGE_X))}px`,
    );
  }
  if (values.eyeY != null) {
    root.style.setProperty(
      "--eye-y",
      `${Math.round(clamp(values.eyeY, -EYE_RANGE_Y, EYE_RANGE_Y_DOWN))}px`,
    );
  }
  if (values.eyeOpen != null) {
    root.style.setProperty("--eye-open", String(clamp(values.eyeOpen, 0, 1)));
  }
}

function syncMirrorStyle(input: HTMLInputElement, mirror: HTMLElement) {
  const style = getComputedStyle(input);
  mirror.style.fontFamily = style.fontFamily;
  mirror.style.fontSize = style.fontSize;
  mirror.style.fontWeight = style.fontWeight;
  mirror.style.fontStyle = style.fontStyle;
  mirror.style.fontVariant = style.fontVariant;
  mirror.style.fontStretch = style.fontStretch;
  mirror.style.letterSpacing = style.letterSpacing;
  mirror.style.textTransform = style.textTransform;
}

function getCaretX(input: HTMLInputElement, mirror: HTMLElement): number {
  syncMirrorStyle(input, mirror);

  const caret = input.selectionStart ?? input.value.length;
  const beforeCaret = input.value.slice(0, caret);
  mirror.textContent = beforeCaret.replace(/ /g, "\u00a0");

  const textWidth = mirror.getBoundingClientRect().width;
  const style = getComputedStyle(input);
  const paddingLeft = Number.parseFloat(style.paddingLeft) || 0;
  const paddingRight = Number.parseFloat(style.paddingRight) || 0;
  const borderLeft = Number.parseFloat(style.borderLeftWidth) || 0;

  return clamp(
    borderLeft + paddingLeft + textWidth - input.scrollLeft,
    borderLeft + paddingLeft,
    input.clientWidth - paddingRight,
  );
}

function getMascotAnchor(root: HTMLElement, mascotX: number): { x: number; y: number } | null {
  const svg = root.querySelector<SVGSVGElement>(".login-mascot-svg");
  if (!svg) {
    return null;
  }
  const rect = svg.getBoundingClientRect();
  return {
    x: rect.left + rect.width / 2 + mascotX,
    y: rect.top + rect.height * 0.52,
  };
}

function lookAtScreenPoint(
  root: HTMLElement,
  targetX: number,
  targetY: number,
  mascotX: number,
): { eyeX: number; eyeY: number } {
  const anchor = getMascotAnchor(root, mascotX);
  if (!anchor) {
    return { eyeX: 0, eyeY: 0 };
  }
  return {
    eyeX: (targetX - anchor.x) * LOOK_GAIN,
    eyeY: (targetY - anchor.y) * LOOK_GAIN,
  };
}

function centerMascot(root: HTMLElement, eyeOpen = 1) {
  setMascotVars(root, { mascotX: 0, eyeX: 0, eyeY: 0, eyeOpen });
}

export function renderEmployeeLoginMascot(): TemplateResult {
  return html`
    <div class="login-mascot-stage" aria-hidden="true">
      <div class="login-mascot-runner">
        <svg class="login-mascot-svg" viewBox="230 250 795 750" focusable="false">
          <path
            class="mascot-body"
            fill="currentColor"
            fill-rule="evenodd"
            d=${LOGIN_MASCOT_BODY_PATH}
          ></path>
          <rect class="eye-hole-cover left" x="507" y="663" width="58" height="92" rx="3"></rect>
          <rect class="eye-hole-cover right" x="691" y="663" width="58" height="92" rx="3"></rect>
          <rect class="eye-white left" x="517" y="673" width="38" height="74" rx="3"></rect>
          <rect class="eye-white right" x="701" y="673" width="38" height="74" rx="3"></rect>
        </svg>
      </div>
    </div>
  `;
}

export function installEmployeeLoginMascot(refs: EmployeeLoginMascotRefs) {
  const element = refs.root;
  const accountInput = refs.accountInput;
  const passwordInput = refs.passwordInput;
  const mirror = refs.mirror;

  if (!element) {
    activeLoginMascotCleanup?.();
    activeLoginMascotCleanup = null;
    return;
  }
  if (!accountInput || !passwordInput || !mirror) {
    const cleanup = installedLoginMascots.get(element);
    cleanup?.();
    if (activeLoginMascotCleanup === cleanup) {
      activeLoginMascotCleanup = null;
    }
    return;
  }
  if (installedLoginMascots.has(element)) {
    return;
  }

  activeLoginMascotCleanup?.();
  activeLoginMascotCleanup = null;

  const abortController = new AbortController();
  const listenerOptions = { signal: abortController.signal };
  const cleanup = () => {
    abortController.abort();
    if (caretFrame) {
      window.cancelAnimationFrame(caretFrame);
      caretFrame = 0;
    }
    window.clearTimeout(moveTimer);
    element.classList.remove("login-mascot-moving");
    installedLoginMascots.delete(element);
  };

  installedLoginMascots.set(element, cleanup);
  activeLoginMascotCleanup = cleanup;
  centerMascot(element);

  let mode: LoginMascotMode = "idle";
  let lastMascotX = 0;
  let moveTimer = 0;
  let caretFrame = 0;
  const reducedMotion = prefersReducedMotion();

  const setMode = (nextMode: LoginMascotMode) => {
    mode = nextMode;
    element.dataset.loginMascotMode = nextMode;

    if (nextMode === "password") {
      centerMascot(element, 0.08);
      return;
    }
    centerMascot(element, 1);
    if (nextMode === "account") {
      scheduleCaretUpdate();
    }
  };

  const setVars = (values: {
    mascotX?: number;
    eyeX?: number;
    eyeY?: number;
    eyeOpen?: number;
  }) => {
    const mascotX = values.mascotX ?? lastMascotX;
    setMascotVars(element, values);

    if (values.mascotX != null && Math.abs(mascotX - lastMascotX) > 3 && !reducedMotion) {
      element.classList.remove("login-mascot-moving");
      void element.offsetWidth;
      element.classList.add("login-mascot-moving");
      window.clearTimeout(moveTimer);
      moveTimer = window.setTimeout(() => {
        element.classList.remove("login-mascot-moving");
      }, 540);
    }
    if (values.mascotX != null) {
      lastMascotX = clamp(mascotX, -BODY_RANGE_X, BODY_RANGE_X);
    }
  };

  const updateFromCaret = () => {
    caretFrame = 0;
    if (mode !== "account" || document.activeElement !== accountInput) {
      return;
    }

    const caretX = getCaretX(accountInput, mirror);
    const style = getComputedStyle(accountInput);
    const paddingLeft = Number.parseFloat(style.paddingLeft) || 0;
    const paddingRight = Number.parseFloat(style.paddingRight) || 0;
    const usableWidth = Math.max(1, accountInput.clientWidth - paddingLeft - paddingRight);
    const ratio = clamp((caretX - paddingLeft) / usableWidth, 0, 1);
    const mascotX = (ratio - 0.5) * BODY_RANGE_X * 2;
    const inputRect = accountInput.getBoundingClientRect();
    const eyes = lookAtScreenPoint(
      element,
      inputRect.left + caretX,
      inputRect.top + inputRect.height * 0.53,
      mascotX,
    );

    setVars({ mascotX, eyeX: eyes.eyeX, eyeY: eyes.eyeY, eyeOpen: 1 });
  };

  function scheduleCaretUpdate() {
    if (caretFrame) {
      return;
    }
    caretFrame = window.requestAnimationFrame(updateFromCaret);
  }

  const updateFromMouse = (event: PointerEvent) => {
    if (mode !== "idle") {
      return;
    }
    const rect = element.getBoundingClientRect();
    const ratioX = clamp((event.clientX - rect.left) / Math.max(1, rect.width), 0, 1);
    const mascotX = (ratioX - 0.5) * BODY_RANGE_X * 2;
    const eyes = lookAtScreenPoint(element, event.clientX, event.clientY, mascotX);
    setVars({ mascotX, eyeX: eyes.eyeX, eyeY: eyes.eyeY, eyeOpen: 1 });
  };

  accountInput.addEventListener("focus", () => setMode("account"), listenerOptions);
  accountInput.addEventListener(
    "blur",
    () => {
      window.requestAnimationFrame(() => {
        if (document.activeElement !== passwordInput) {
          setMode("idle");
        }
      });
    },
    listenerOptions,
  );
  passwordInput.addEventListener("focus", () => setMode("password"), listenerOptions);
  passwordInput.addEventListener(
    "blur",
    () => {
      window.requestAnimationFrame(() => {
        if (document.activeElement === accountInput) {
          setMode("account");
          return;
        }
        setMode("idle");
      });
    },
    listenerOptions,
  );

  for (const eventName of [
    "input",
    "keyup",
    "click",
    "select",
    "compositionupdate",
    "compositionend",
  ]) {
    accountInput.addEventListener(eventName, scheduleCaretUpdate, listenerOptions);
  }

  element.addEventListener("pointermove", updateFromMouse, listenerOptions);
  element.addEventListener(
    "pointerleave",
    () => {
      if (mode === "idle") {
        centerMascot(element);
      }
    },
    listenerOptions,
  );
  window.addEventListener(
    "resize",
    () => {
      if (mode === "account") {
        scheduleCaretUpdate();
        return;
      }
      centerMascot(element, mode === "password" ? 0.08 : 1);
    },
    listenerOptions,
  );
}
