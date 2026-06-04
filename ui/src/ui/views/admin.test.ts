/* @vitest-environment jsdom */

import { render } from "lit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "../../i18n/index.ts";
import { renderAdmin, type AdminViewProps } from "./admin.ts";

const dialogRestores: Array<() => void> = [];

function installDialogMethod(name: "showModal" | "close", impl: (this: HTMLDialogElement) => void) {
  const original = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, name);
  Object.defineProperty(HTMLDialogElement.prototype, name, {
    configurable: true,
    value: impl,
  });
  dialogRestores.push(() => {
    if (original) {
      Object.defineProperty(HTMLDialogElement.prototype, name, original);
    } else {
      delete (HTMLDialogElement.prototype as unknown as Record<string, unknown>)[name];
    }
  });
}

function createProps(overrides: Partial<AdminViewProps> = {}): AdminViewProps {
  return {
    loading: false,
    entries: [
      {
        accountId: "eon",
        employeeId: "eon",
        displayName: "Eon",
        email: "eon@example.com",
        department: "Platform",
        globalRole: "admin",
        status: "active",
        lastLoginAt: "2026-05-31T00:00:00.000Z",
        groups: ["Platform"],
      },
    ],
    error: null,
    query: "",
    detailLoading: false,
    detail: null,
    detailError: null,
    message: null,
    roleModalOpen: false,
    roleModalAccountName: null,
    roleModalNextRole: "member",
    groupScopeOptions: [],
    onQueryChange: () => undefined,
    onRefresh: () => undefined,
    onOpenDetail: () => undefined,
    onCloseDetail: () => undefined,
    onOpenRoleModal: () => undefined,
    onCloseRoleModal: () => undefined,
    onRoleChangeSelect: () => undefined,
    onConfirmRoleChange: () => undefined,
    onAddMembership: () => undefined,
    onRemoveMembership: () => undefined,
    ...overrides,
  };
}

describe("renderAdmin", () => {
  beforeEach(async () => {
    await i18n.setLocale("en");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    while (dialogRestores.length > 0) {
      dialogRestores.pop()?.();
    }
  });

  it("renders the admin accounts list", async () => {
    const container = document.createElement("div");
    render(renderAdmin(createProps()), container);
    await Promise.resolve();

    const text = container.textContent?.replace(/\s+/g, " ").trim() ?? "";
    expect(text).toContain("Admin");
    expect(text).toContain("Eon");
    expect(text).toContain("Change role");
  });

  it("renders the role change modal when requested", async () => {
    installDialogMethod("showModal", function showModal(this: HTMLDialogElement) {
      this.setAttribute("open", "");
    });

    const container = document.createElement("div");
    render(
      renderAdmin(
        createProps({
          roleModalOpen: true,
          roleModalAccountName: "Eon",
          roleModalNextRole: "admin",
        }),
      ),
      container,
    );
    await Promise.resolve();

    expect(container.querySelector("dialog")?.hasAttribute("open")).toBe(true);
    expect(container.textContent).toContain("Change role");
  });
});
