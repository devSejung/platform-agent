function isStorage(value: unknown): value is Storage {
  return (
    Boolean(value) &&
    typeof (value as Storage).getItem === "function" &&
    typeof (value as Storage).setItem === "function"
  );
}

function getSafeStorage(name: "localStorage" | "sessionStorage"): Storage | null {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
  const descriptorValue = descriptor && !descriptor.get ? descriptor.value : undefined;

  if (typeof process !== "undefined" && process.env?.VITEST) {
    if (isStorage(descriptorValue)) {
      return descriptorValue;
    }
    const direct = globalThis[name];
    return isStorage(direct) ? direct : null;
  }

  if (typeof window !== "undefined" && typeof document !== "undefined") {
    try {
      const storage = window[name];
      if (isStorage(storage)) {
        return storage;
      }
    } catch {
      // fall through to the global descriptor fallback below
    }
  }

  return isStorage(descriptorValue) ? descriptorValue : null;
}

export function getSafeLocalStorage(): Storage | null {
  return getSafeStorage("localStorage");
}

export function getSafeSessionStorage(): Storage | null {
  return getSafeStorage("sessionStorage");
}
