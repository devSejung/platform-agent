import type { IncomingMessage, ServerResponse } from "node:http";
import { readSkillHubIconAsset } from "../agents/skill-hub-icon-assets.js";
import { SKILL_HUB_ICON_HTTP_BASE_PATH } from "../agents/skill-hub-presentation.js";
import { readEmployeeSession } from "./employee-web-auth.js";

const ICON_PATH_PATTERN = new RegExp(
  `^${SKILL_HUB_ICON_HTTP_BASE_PATH.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/([a-f0-9]{64})\\.png$`,
);

export async function handleSkillHubIconHttpRequest(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
  if (!pathname.startsWith(`${SKILL_HUB_ICON_HTTP_BASE_PATH}/`)) {
    return false;
  }
  const method = (req.method ?? "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    res.statusCode = 405;
    res.setHeader("Allow", "GET, HEAD");
    res.end("Method Not Allowed");
    return true;
  }
  if (!readEmployeeSession(req)) {
    res.statusCode = 401;
    res.setHeader("Cache-Control", "no-store");
    res.end("employee sign-in required");
    return true;
  }
  const match = ICON_PATH_PATTERN.exec(pathname);
  if (!match?.[1]) {
    res.statusCode = 400;
    res.setHeader("Cache-Control", "no-store");
    res.end("invalid icon asset id");
    return true;
  }

  const assetId = match[1];
  const data = await readSkillHubIconAsset({ assetId });
  if (!data) {
    res.statusCode = 404;
    res.setHeader("Cache-Control", "no-store");
    res.end("not found");
    return true;
  }
  const etag = `"${assetId}"`;
  res.setHeader("Content-Type", "image/png");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
  res.setHeader("ETag", etag);
  if (req.headers["if-none-match"] === etag) {
    res.statusCode = 304;
    res.end();
    return true;
  }

  res.statusCode = 200;
  res.setHeader("Content-Length", String(data.length));
  res.end(method === "HEAD" ? undefined : data);
  return true;
}
