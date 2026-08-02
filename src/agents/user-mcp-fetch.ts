import type { Dispatcher } from "undici";
import { fetchWithRuntimeDispatcher } from "../infra/net/runtime-fetch.js";
import {
  closeDispatcher,
  createPinnedDispatcher,
  resolvePinnedHostnameWithPolicy,
  type SsrFPolicy,
} from "../infra/net/ssrf.js";

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function inputUrl(input: RequestInfo | URL): URL {
  if (input instanceof URL) {
    return input;
  }
  return new URL(typeof input === "string" ? input : input.url);
}

export function createUserMcpGuardedFetch(baseUrl: string, policy: SsrFPolicy) {
  const base = new URL(baseUrl);
  let dispatcherPromise: Promise<Dispatcher> | undefined;
  const getDispatcher = () =>
    (dispatcherPromise ??= resolvePinnedHostnameWithPolicy(base.hostname, { policy }).then(
      (pinned) => createPinnedDispatcher(pinned, undefined, policy),
    ));
  const fetch: FetchLike = async (input, init) => {
    const target = inputUrl(input);
    if (target.origin !== base.origin) {
      throw new Error("blocked_by_policy: cross-origin MCP endpoint");
    }
    return await fetchWithRuntimeDispatcher(target.toString(), {
      ...init,
      redirect: "manual",
      dispatcher: await getDispatcher(),
    });
  };
  return {
    fetch,
    async dispose() {
      await closeDispatcher(await dispatcherPromise?.catch(() => undefined));
    },
  };
}
