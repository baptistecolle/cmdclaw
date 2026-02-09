#!/usr/bin/env python3
from __future__ import annotations

import argparse
import base64
import json
import os
import sys
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


def auth_header(api_key: str) -> str:
    token = base64.b64encode(f"{api_key}:".encode("utf-8")).decode("ascii")
    return f"Basic {token}"


def resolve_template_id(template_id: str | None, metadata_path: Path | None) -> tuple[str, Path | None]:
    if template_id:
        return template_id, metadata_path
    if metadata_path is None:
        raise RuntimeError("Provide either --template-id or --template-metadata")
    if not metadata_path.exists():
        raise RuntimeError(f"Template metadata not found: {metadata_path}")
    meta = json.loads(metadata_path.read_text(encoding="utf-8"))
    resolved = meta.get("templateId")
    if not resolved:
        raise RuntimeError(f"templateId missing in metadata: {metadata_path}")
    return resolved, metadata_path


def resolve_payload_path(payload_path: Path | None, metadata_path: Path | None) -> Path:
    if payload_path:
        return payload_path
    if metadata_path is None:
        raise RuntimeError("Provide --payload when using --template-id directly")
    meta = json.loads(metadata_path.read_text(encoding="utf-8"))
    from_meta = meta.get("examplePayloadPath")
    if not from_meta:
        raise RuntimeError("examplePayloadPath missing in metadata; provide --payload explicitly")
    return Path(from_meta)


def fill_pdf(template_id: str, api_key: str, payload: dict, version_number: int | None) -> bytes:
    url = f"https://app.useanvil.com/api/v1/fill/{template_id}.pdf"
    if version_number is not None:
        url = f"{url}?versionNumber={version_number}"

    req = Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        method="POST",
        headers={
            "Authorization": auth_header(api_key),
            "Content-Type": "application/json",
            "Accept": "application/pdf",
        },
    )
    try:
        with urlopen(req) as resp:
            return resp.read()
    except HTTPError as err:
        detail = err.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Anvil API error {err.code}: {detail}") from err
    except URLError as err:
        raise RuntimeError(f"Network error: {err}") from err


def main() -> int:
    parser = argparse.ArgumentParser(description="Fill Anvil PDF template from metadata/template ID and payload JSON")
    parser.add_argument("--template-id", help="Anvil PDF template ID")
    parser.add_argument("--template-metadata", help="Path to *.template.json file")
    parser.add_argument("--payload", help="Path to payload JSON; default is metadata examplePayloadPath")
    parser.add_argument("--out", default="output/anvil_filled.pdf", help="Output PDF path")
    parser.add_argument("--version-number", type=int, default=None, help="Optional fill versionNumber")
    parser.add_argument("--no-interactive", action="store_true", help="Flatten output PDF")
    parser.add_argument(
        "--default-read-only",
        action="store_true",
        help="When interactive mode is enabled, set fields read-only by default",
    )
    args = parser.parse_args()

    api_key = os.getenv("ANVIL_API_KEY")
    if not api_key:
        print("Missing ANVIL_API_KEY environment variable", file=sys.stderr)
        return 2

    meta_path = Path(args.template_metadata) if args.template_metadata else None
    payload_arg = Path(args.payload) if args.payload else None

    try:
        template_id, resolved_meta = resolve_template_id(args.template_id, meta_path)
        payload_path = resolve_payload_path(payload_arg, resolved_meta)
        if not payload_path.exists():
            raise RuntimeError(f"Payload file not found: {payload_path}")

        payload = json.loads(payload_path.read_text(encoding="utf-8"))
        if not isinstance(payload, dict):
            raise RuntimeError("Payload JSON must be an object")

        if not args.no_interactive:
            payload["useInteractiveFields"] = True
            payload["defaultReadOnly"] = bool(args.default_read_only)

        pdf_bytes = fill_pdf(
            template_id=template_id,
            api_key=api_key,
            payload=payload,
            version_number=args.version_number,
        )
    except RuntimeError as err:
        print(str(err), file=sys.stderr)
        return 1

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_bytes(pdf_bytes)
    print(f"Filled PDF written to: {out_path}")
    print(f"Template ID: {template_id}")
    print(f"Payload used: {payload_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
