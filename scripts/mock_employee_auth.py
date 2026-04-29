#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


DEFAULT_BIND = "127.0.0.1"
DEFAULT_PORT = 18080
DEFAULT_LOGIN_PATH = "/login"
DEFAULT_ADSSO_PATH = "/adsso"
DEFAULT_HEALTH_PATH = "/healthz"
DEFAULT_IDENTIFIER = "eon@samsung.com"
DEFAULT_PASSWORD = "456123"
DEFAULT_EMPLOYEE_ID = "eon"
DEFAULT_AGENT_ID = "eon"
DEFAULT_SESSION_KEY = "agent:eon:main"
DEFAULT_NAME = "Eon"
DEFAULT_DEPARTMENT = "Samsung"


def default_account() -> dict:
    return {
        "identifier": DEFAULT_IDENTIFIER,
        "password": DEFAULT_PASSWORD,
        "employeeId": DEFAULT_EMPLOYEE_ID,
        "name": DEFAULT_NAME,
        "department": DEFAULT_DEPARTMENT,
        "agentId": DEFAULT_AGENT_ID,
        "sessionKey": DEFAULT_SESSION_KEY,
    }


def default_accounts() -> list[dict]:
    return [
        default_account(),
        {
            "identifier": "minji@samsung.com",
            "password": DEFAULT_PASSWORD,
            "employeeId": "minji",
            "name": "Minji",
            "department": DEFAULT_DEPARTMENT,
            "agentId": "minji",
            "sessionKey": "agent:minji:main",
        },
        {
            "identifier": "jiwon@samsung.com",
            "password": DEFAULT_PASSWORD,
            "employeeId": "jiwon",
            "name": "Jiwon",
            "department": DEFAULT_DEPARTMENT,
            "agentId": "jiwon",
            "sessionKey": "agent:jiwon:main",
        },
    ]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Mock employee auth service for OpenClaw")
    parser.add_argument("--bind", default=DEFAULT_BIND)
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--login-path", default=DEFAULT_LOGIN_PATH)
    parser.add_argument("--adsso-path", default=DEFAULT_ADSSO_PATH)
    parser.add_argument("--health-path", default=DEFAULT_HEALTH_PATH)
    parser.add_argument("--identifier", default=DEFAULT_IDENTIFIER)
    parser.add_argument("--password", default=DEFAULT_PASSWORD)
    parser.add_argument("--employee-id", default=DEFAULT_EMPLOYEE_ID)
    parser.add_argument("--agent-id", default=DEFAULT_AGENT_ID)
    parser.add_argument("--session-key", default=DEFAULT_SESSION_KEY)
    parser.add_argument("--name", default=DEFAULT_NAME)
    parser.add_argument("--department", default=DEFAULT_DEPARTMENT)
    parser.add_argument("--accounts-file", default="")
    parser.add_argument("--adsso-default-identifier", default="")
    parser.add_argument("--bearer-token", default="")
    return parser.parse_args()


def normalize_account(raw: dict) -> dict:
    identifier = str(raw.get("identifier") or raw.get("username") or raw.get("email") or "").strip()
    password = str(raw.get("password") or "")
    employee_id = str(raw.get("employeeId") or identifier.split("@")[0] or "").strip()
    name = str(raw.get("name") or employee_id or identifier).strip()
    department = str(raw.get("department") or "").strip()
    agent_id = str(raw.get("agentId") or employee_id or "main").strip()
    session_key = str(raw.get("sessionKey") or f"agent:{agent_id}:main").strip()
    if not identifier:
        raise ValueError("identifier is required")
    if not employee_id:
        raise ValueError(f"employeeId missing for {identifier}")
    if not agent_id:
        raise ValueError(f"agentId missing for {identifier}")
    if not session_key:
        raise ValueError(f"sessionKey missing for {identifier}")
    return {
        "identifier": identifier,
        "password": password,
        "employeeId": employee_id,
        "name": name,
        "department": department,
        "agentId": agent_id,
        "sessionKey": session_key,
    }


def load_accounts(args: argparse.Namespace) -> tuple[list[dict], str | None]:
    if not args.accounts_file:
        accounts = default_accounts()
        adsso_default_identifier = args.adsso_default_identifier.strip() or accounts[0]["identifier"]
        return accounts, adsso_default_identifier

    raw = json.loads(Path(args.accounts_file).read_text(encoding="utf-8"))
    if isinstance(raw, dict):
        raw_accounts = raw.get("accounts")
        adsso_default_identifier = str(
            raw.get("adssoDefaultIdentifier") or args.adsso_default_identifier or ""
        ).strip()
    else:
        raw_accounts = raw
        adsso_default_identifier = args.adsso_default_identifier.strip()
    if not isinstance(raw_accounts, list) or not raw_accounts:
        raise ValueError("accounts-file must contain a non-empty accounts array")
    accounts = [normalize_account(entry) for entry in raw_accounts if isinstance(entry, dict)]
    if not accounts:
        raise ValueError("accounts-file did not contain any valid account objects")
    if adsso_default_identifier:
        return accounts, adsso_default_identifier
    return accounts, accounts[0]["identifier"]


def build_handler(args: argparse.Namespace):
    accounts, adsso_default_identifier = load_accounts(args)
    accounts_by_identifier = {entry["identifier"]: entry for entry in accounts}

    def resolve_adsso_account(payload: dict) -> dict | None:
        identifier = str(
            payload.get("identifier")
            or payload.get("username")
            or payload.get("email")
            or adsso_default_identifier
            or ""
        ).strip()
        return accounts_by_identifier.get(identifier)

    class Handler(BaseHTTPRequestHandler):
        server_version = "OpenClawEmployeeAuthMock/1.0"

        def _send_json(self, status: int, payload: dict) -> None:
            body = json.dumps(payload).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-cache")
            self.end_headers()
            self.wfile.write(body)

        def _read_json(self) -> dict | None:
            content_length = self.headers.get("Content-Length", "0").strip()
            try:
                length = int(content_length)
            except ValueError:
                return None
            raw = self.rfile.read(max(0, length))
            try:
                parsed = json.loads(raw.decode("utf-8") if raw else "{}")
            except json.JSONDecodeError:
                return None
            return parsed if isinstance(parsed, dict) else None

        def log_message(self, fmt: str, *args_) -> None:
            return

        def do_GET(self) -> None:
            if self.path != args.health_path:
                self._send_json(HTTPStatus.NOT_FOUND, {"ok": False, "message": "not found"})
                return
            self._send_json(
                HTTPStatus.OK,
                {
                    "ok": True,
                    "service": "mock-employee-auth",
                    "loginPath": args.login_path,
                    "adssoPath": args.adsso_path,
                    "accounts": [
                        {
                            "identifier": entry["identifier"],
                            "employeeId": entry["employeeId"],
                            "agentId": entry["agentId"],
                            "sessionKey": entry["sessionKey"],
                        }
                        for entry in accounts
                    ],
                },
            )

        def do_POST(self) -> None:
            if self.path not in {args.login_path, args.adsso_path}:
                self._send_json(HTTPStatus.NOT_FOUND, {"authenticated": False, "message": "not found"})
                return

            if args.bearer_token:
                authorization = self.headers.get("Authorization", "")
                expected = f"Bearer {args.bearer_token}"
                if authorization != expected:
                    self._send_json(
                        HTTPStatus.UNAUTHORIZED,
                        {"authenticated": False, "message": "invalid auth bearer token"},
                    )
                    return

            payload = self._read_json()
            if payload is None:
                self._send_json(
                    HTTPStatus.BAD_REQUEST,
                    {"authenticated": False, "message": "invalid json payload"},
                )
                return

            if self.path == args.adsso_path:
                account = resolve_adsso_account(payload)
                if not account:
                    self._send_json(
                        HTTPStatus.UNAUTHORIZED,
                        {"authenticated": False, "message": "unknown adsso account"},
                    )
                    return
                self._send_json(
                    HTTPStatus.OK,
                    {
                        "authenticated": True,
                        "employeeId": account["employeeId"],
                        "name": account["name"],
                        "department": account["department"],
                        "agentId": account["agentId"],
                        "sessionKey": account["sessionKey"],
                    },
                )
                return

            identifier = str(payload.get("identifier") or payload.get("username") or "").strip()
            password = str(payload.get("password") or "")
            account = accounts_by_identifier.get(identifier)

            if account and password == account["password"]:
                self._send_json(
                    HTTPStatus.OK,
                    {
                        "authenticated": True,
                        "employeeId": account["employeeId"],
                        "name": account["name"],
                        "department": account["department"],
                        "agentId": account["agentId"],
                        "sessionKey": account["sessionKey"],
                    },
                )
                return

            self._send_json(
                HTTPStatus.UNAUTHORIZED,
                {"authenticated": False, "message": "invalid credentials"},
            )

    return Handler


def main() -> int:
    args = parse_args()
    accounts, adsso_default_identifier = load_accounts(args)
    server = ThreadingHTTPServer((args.bind, args.port), build_handler(args))
    print(
        json.dumps(
            {
                "bind": args.bind,
                "port": args.port,
                "loginPath": args.login_path,
                "adssoPath": args.adsso_path,
                "healthPath": args.health_path,
                "adssoDefaultIdentifier": adsso_default_identifier,
                "accounts": [
                    {
                        "identifier": entry["identifier"],
                        "employeeId": entry["employeeId"],
                        "agentId": entry["agentId"],
                        "sessionKey": entry["sessionKey"],
                    }
                    for entry in accounts
                ],
            }
        ),
        flush=True,
    )
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
