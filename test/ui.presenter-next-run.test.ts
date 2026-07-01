import { describe, expect, it } from "vitest";
import { formatNextRun } from "../ui/src/ui/presenter.ts";

describe("formatNextRun", () => {
  it("returns n/a for nullish values", () => {
    expect(formatNextRun(null)).toBe("해당 없음");
    expect(formatNextRun(undefined)).toBe("해당 없음");
  });

  it("includes weekday and relative time", () => {
    const ts = Date.UTC(2026, 1, 23, 15, 0, 0);
    const out = formatNextRun(ts);
    expect(out).toMatch(/^[A-Za-z]{3}, /);
    expect(out).toContain("(");
    expect(out).toContain(")");
  });
});
