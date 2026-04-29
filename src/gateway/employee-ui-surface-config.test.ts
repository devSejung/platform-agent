import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveEmployeeUiSurfaceConfig, resetEmployeeUiSurfaceConfigCacheForTests } from "./employee-ui-surface-config.js";

describe("resolveEmployeeUiSurfaceConfig", () => {
  afterEach(() => {
    delete process.env.OPENCLAW_EMPLOYEE_UI_EXTRA_PATH;
    delete process.env.OPENCLAW_CONFIG_PATH;
    resetEmployeeUiSurfaceConfigCacheForTests();
  });

  it("merges config controlUi settings with an external ui file", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-employee-ui-"));
    process.env.OPENCLAW_CONFIG_PATH = path.join(dir, "exam_emp_openclaw.json");
    await fs.writeFile(
      path.join(dir, "employee-ui.extra.json"),
      JSON.stringify(
        {
          docsUrl: "https://docs.company.example/platformclaw",
          announcement: {
            title: "External title",
            linkLabel: "Read more",
          },
        },
        null,
        2,
      ),
      "utf-8",
    );

    const resolved = resolveEmployeeUiSurfaceConfig({
      gateway: {
        controlUi: {
          announcementBody: "Base body",
          announcementLinkUrl: "https://notice.company.example/base",
        },
      },
    });

    expect(resolved).toEqual({
      docsUrl: "https://docs.company.example/platformclaw",
      announcement: {
        title: "External title",
        body: "Base body",
        linkLabel: "Read more",
        linkUrl: "https://notice.company.example/base",
      },
    });
  });

  it("keeps the last known good value when the external file becomes invalid", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-employee-ui-"));
    process.env.OPENCLAW_CONFIG_PATH = path.join(dir, "exam_emp_openclaw.json");
    const extraPath = path.join(dir, "employee-ui.extra.json");
    await fs.writeFile(
      extraPath,
      JSON.stringify(
        {
          announcementTitle: "Stable title",
          announcementBody: "Stable body",
        },
        null,
        2,
      ),
      "utf-8",
    );

    const initial = resolveEmployeeUiSurfaceConfig({});
    expect(initial).toEqual({
      announcement: {
        title: "Stable title",
        body: "Stable body",
      },
    });

    await fs.writeFile(extraPath, "{ invalid json", "utf-8");

    const afterInvalidEdit = resolveEmployeeUiSurfaceConfig({});
    expect(afterInvalidEdit).toEqual(initial);
  });
});
