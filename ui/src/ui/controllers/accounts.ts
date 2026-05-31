import type { GatewayBrowserClient } from "../gateway.ts";

export type AccountDirectoryEntry = {
  accountId: string;
  employeeId: string;
  displayName: string;
  email: string | null;
  department: string | null;
  globalRole: "member" | "admin";
  status: "active" | "disabled";
};

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function searchDirectoryAccounts(params: {
  client: GatewayBrowserClient | null;
  connected: boolean;
  query: string;
  limit?: number;
}): Promise<{ entries: AccountDirectoryEntry[]; error: string | null }> {
  if (!params.client || !params.connected) {
    return { entries: [], error: null };
  }
  try {
    const result = await params.client.request<{ entries: AccountDirectoryEntry[] }>("accounts.search", {
      query: params.query,
      limit: params.limit ?? 12,
    });
    return { entries: result?.entries ?? [], error: null };
  } catch (err) {
    return { entries: [], error: getErrorMessage(err) };
  }
}
