import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  resolveEmployeeActivationPath,
  upsertEmployeeActivationRecord,
} from "./employee-activation.js";

describe("employee activation store", () => {
  it("upserts activation entries to the configured path", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-employee-activation-"));
    const filePath = path.join(tmpDir, "employee-activation.json");

    const result = await upsertEmployeeActivationRecord(
      {
        employeeId: "eon",
        agentId: "eon",
        name: "Eon",
        department: "Platform",
      },
      {
        OPENCLAW_EMPLOYEE_ACTIVATION_PATH: filePath,
      },
    );
    expect(result).toEqual({
      filePath,
      created: true,
    });

    const raw = await fs.readFile(filePath, "utf8");
    expect(JSON.parse(raw)).toMatchObject({
      version: 1,
      employees: {
        eon: {
          agentId: "eon",
          name: "Eon",
          department: "Platform",
        },
      },
    });
  });

  it("resolves the configured activation path", () => {
    expect(
      resolveEmployeeActivationPath({
        OPENCLAW_EMPLOYEE_ACTIVATION_PATH: "/tmp/company/employee-activation.json",
      } as NodeJS.ProcessEnv),
    ).toBe(path.resolve("/tmp/company/employee-activation.json"));
  });
});
