import fs from "node:fs/promises";
import path from "node:path";

export const EMPLOYEE_ACTIVATION_PATH_ENV = "OPENCLAW_EMPLOYEE_ACTIVATION_PATH";

export type EmployeeActivationEntry = {
  employeeId: string;
  agentId: string;
  activatedAt: string;
  name?: string;
  department?: string;
  email?: string;
};

type EmployeeActivationStore = {
  version: 1;
  employees: Record<string, Omit<EmployeeActivationEntry, "employeeId">>;
};

function defaultActivationPath(): string {
  return path.resolve(process.cwd(), "data", "employee-activation.json");
}

export function resolveEmployeeActivationPath(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env[EMPLOYEE_ACTIVATION_PATH_ENV]?.trim();
  return configured ? path.resolve(configured) : defaultActivationPath();
}

async function readActivationStore(filePath: string): Promise<EmployeeActivationStore> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as {
      version?: unknown;
      employees?: unknown;
    };
    const employees =
      parsed && typeof parsed === "object" && parsed.employees && typeof parsed.employees === "object"
        ? (parsed.employees as Record<string, Omit<EmployeeActivationEntry, "employeeId">>)
        : {};
    return {
      version: 1,
      employees,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        version: 1,
        employees: {},
      };
    }
    throw error;
  }
}

async function writeActivationStore(
  filePath: string,
  store: EmployeeActivationStore,
): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now().toString(36)}`;
  const payload = `${JSON.stringify(store, null, 2)}\n`;
  try {
    await fs.writeFile(tmpPath, payload, "utf8");
    await fs.rename(tmpPath, filePath);
  } catch (error) {
    await fs.unlink(tmpPath).catch(() => {});
    throw error;
  }
}

export async function upsertEmployeeActivationRecord(
  entry: Omit<EmployeeActivationEntry, "activatedAt"> & { activatedAt?: string },
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ filePath: string; created: boolean }> {
  const filePath = resolveEmployeeActivationPath(env);
  const store = await readActivationStore(filePath);
  const created = !store.employees[entry.employeeId];
  store.employees[entry.employeeId] = {
    agentId: entry.agentId,
    activatedAt: entry.activatedAt ?? new Date().toISOString(),
    name: entry.name,
    department: entry.department,
    email: entry.email,
  };
  await writeActivationStore(filePath, store);
  return { filePath, created };
}
