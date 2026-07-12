import json
import os
import urllib.error
import urllib.request


class CredentialError(RuntimeError):
    pass


def get(name: str) -> str:
    endpoint = os.environ.get("PLATFORMCLAW_RUNTIME_CREDENTIAL_ENDPOINT", "").rstrip("/")
    token = os.environ.get("PLATFORMCLAW_RUNTIME_CREDENTIAL_TOKEN", "")
    if not endpoint or not token:
        raise CredentialError(
            "PlatformClaw credential runtime is not available for this process. "
            "Run the skill through a PlatformClaw Runtime exec path instead of direct python."
        )

    payload = json.dumps({"definitionKey": name}).encode("utf-8")
    req = urllib.request.Request(
        f"{endpoint}/credentials/get",
        data=payload,
        method="POST",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as res:
            body = json.loads(res.read().decode("utf-8"))
    except urllib.error.HTTPError as err:
        detail = err.read().decode("utf-8", errors="replace")
        try:
            parsed = json.loads(detail)
            message = parsed.get("error") if isinstance(parsed, dict) else None
        except json.JSONDecodeError:
            message = None
        raise CredentialError(str(message or detail or err)) from err

    if not body.get("ok"):
        raise CredentialError(str(body.get("error") or "credential lookup failed"))
    value = body.get("value")
    if not isinstance(value, str):
        raise CredentialError("credential response did not contain a string value")
    return value
