#!/usr/bin/env python3
from __future__ import annotations

import argparse
import base64
import json
import mimetypes
import os
import re
import sys
import uuid
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

GRAPHQL_URL = "https://graphql.useanvil.com"


def auth_header(api_key: str) -> str:
    token = base64.b64encode(f"{api_key}:".encode("utf-8")).decode("ascii")
    return f"Basic {token}"


def slugify(value: str) -> str:
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", value).strip("-").lower()
    return slug or "template"


def request_json(url: str, method: str, headers: dict[str, str], body: bytes) -> dict[str, Any]:
    req = Request(url, data=body, headers=headers, method=method)
    try:
        with urlopen(req) as resp:
            raw = resp.read().decode("utf-8")
    except HTTPError as err:
        detail = err.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {err.code}: {detail}") from err
    except URLError as err:
        raise RuntimeError(f"Network error: {err}") from err

    try:
        return json.loads(raw)
    except json.JSONDecodeError as err:
        raise RuntimeError(f"Non-JSON response: {raw[:1000]}") from err


def graphql_json(api_key: str, query: str, variables: dict[str, Any]) -> dict[str, Any]:
    payload = {"query": query, "variables": variables}
    out = request_json(
        url=GRAPHQL_URL,
        method="POST",
        headers={
            "Authorization": auth_header(api_key),
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
        body=json.dumps(payload).encode("utf-8"),
    )
    if out.get("errors"):
        raise RuntimeError(f"GraphQL errors: {json.dumps(out['errors'], ensure_ascii=False)}")
    return out.get("data", {})


def graphql_upload(
    api_key: str,
    query: str,
    variables: dict[str, Any],
    upload_var_path: str,
    file_path: Path,
) -> dict[str, Any]:
    boundary = f"----anvil-boundary-{uuid.uuid4().hex}"
    filename = file_path.name
    mime = mimetypes.guess_type(filename)[0] or "application/pdf"
    file_bytes = file_path.read_bytes()

    operations = {"query": query, "variables": variables}
    mapping = {"0": [upload_var_path]}

    parts: list[bytes] = []

    def add_part(name: str, content: bytes, content_type: str | None = None, fname: str | None = None) -> None:
        header = [f"--{boundary}".encode("utf-8")]
        if fname is None:
            header.append(f'Content-Disposition: form-data; name="{name}"'.encode("utf-8"))
        else:
            header.append(
                f'Content-Disposition: form-data; name="{name}"; filename="{fname}"'.encode("utf-8")
            )
        if content_type:
            header.append(f"Content-Type: {content_type}".encode("utf-8"))
        header.append(b"")
        parts.extend([b"\r\n".join(header), content])

    add_part("operations", json.dumps(operations).encode("utf-8"), "application/json")
    add_part("map", json.dumps(mapping).encode("utf-8"), "application/json")
    add_part("0", file_bytes, mime, filename)
    parts.append(f"--{boundary}--".encode("utf-8"))

    body = b"\r\n".join(parts) + b"\r\n"

    out = request_json(
        url=GRAPHQL_URL,
        method="POST",
        headers={
            "Authorization": auth_header(api_key),
            "Content-Type": f"multipart/form-data; boundary={boundary}",
            "Accept": "application/json",
        },
        body=body,
    )
    if out.get("errors"):
        raise RuntimeError(f"GraphQL errors: {json.dumps(out['errors'], ensure_ascii=False)}")
    return out.get("data", {})


def main() -> int:
    parser = argparse.ArgumentParser(description="Create Anvil template from PDF and save metadata/payload files")
    parser.add_argument("--pdf", required=True, help="Path to source PDF")
    parser.add_argument("--title", help="Template title (defaults to PDF stem)")
    parser.add_argument("--output-dir", default="output/anvil_templates", help="Directory for saved files")
    parser.add_argument("--no-publish", action="store_true", help="Skip publishCast step")
    parser.add_argument(
        "--detect-fields",
        dest="detect_fields",
        action="store_true",
        default=True,
        help="Enable native PDF form-field detection (default: enabled)",
    )
    parser.add_argument(
        "--no-detect-fields",
        dest="detect_fields",
        action="store_false",
        help="Disable native PDF form-field detection",
    )
    parser.add_argument(
        "--advanced-detect-fields",
        dest="advanced_detect_fields",
        action="store_true",
        default=True,
        help="Enable advanced field heuristics for native form fields (default: enabled)",
    )
    parser.add_argument(
        "--no-advanced-detect-fields",
        dest="advanced_detect_fields",
        action="store_false",
        help="Disable advanced field heuristics for native form fields",
    )
    parser.add_argument(
        "--detect-boxes-advanced",
        dest="detect_boxes_advanced",
        action="store_true",
        default=True,
        help="Enable Anvil Document AI box detection for non-fillable PDFs (default: enabled)",
    )
    parser.add_argument(
        "--no-detect-boxes-advanced",
        dest="detect_boxes_advanced",
        action="store_false",
        help="Disable Anvil Document AI box detection",
    )
    parser.add_argument(
        "--alias-id",
        action="append",
        default=[],
        help="Provide expected field aliases for AI mapping (repeatable)",
    )
    args = parser.parse_args()

    api_key = os.getenv("ANVIL_API_KEY")
    if not api_key:
        print("Missing ANVIL_API_KEY environment variable", file=sys.stderr)
        return 2

    pdf_path = Path(args.pdf)
    if not pdf_path.exists():
        print(f"PDF not found: {pdf_path}", file=sys.stderr)
        return 2

    title = args.title or pdf_path.stem

    create_query = """
mutation CreateCast(
  $title: String,
  $file: Upload!,
  $isTemplate: Boolean,
  $detectFields: Boolean,
  $detectBoxesAdvanced: Boolean,
  $advancedDetectFields: Boolean,
  $aliasIds: JSON
) {
  createCast(
    title: $title
    file: $file
    isTemplate: $isTemplate
    detectFields: $detectFields
    detectBoxesAdvanced: $detectBoxesAdvanced
    advancedDetectFields: $advancedDetectFields
    aliasIds: $aliasIds
  ) {
    eid
    name
    title
    hasBeenPublished
    publishedNumber
    latestDraftVersionNumber
    exampleData
    fieldInfo
  }
}
"""

    variables = {
        "title": title,
        "file": None,
        "isTemplate": True,
        "detectFields": bool(args.detect_fields),
        "detectBoxesAdvanced": bool(args.detect_boxes_advanced),
        "advancedDetectFields": bool(args.advanced_detect_fields),
        "aliasIds": args.alias_id or None,
    }

    try:
        data = graphql_upload(
            api_key=api_key,
            query=create_query,
            variables=variables,
            upload_var_path="variables.file",
            file_path=pdf_path,
        )
        cast = data["createCast"]

        if not args.no_publish:
            publish_query = """
mutation PublishCast($eid: String!, $title: String!, $description: String) {
  publishCast(eid: $eid, title: $title, description: $description) {
    eid
    name
    title
    hasBeenPublished
    publishedNumber
    latestDraftVersionNumber
    exampleData
    fieldInfo
  }
}
"""
            data = graphql_json(
                api_key=api_key,
                query=publish_query,
                variables={
                    "eid": cast["eid"],
                    "title": cast.get("title") or title,
                    "description": "Published via Codex skill script",
                },
            )
            cast = data["publishCast"]

        cast_query = """
query Cast($eid: String!) {
  cast(eid: $eid) {
    eid
    name
    title
    hasBeenPublished
    publishedNumber
    latestDraftVersionNumber
    exampleData
    fieldInfo
  }
}
"""
        data = graphql_json(api_key=api_key, query=cast_query, variables={"eid": cast["eid"]})
        cast = data["cast"]
    except RuntimeError as err:
        print(str(err), file=sys.stderr)
        return 1

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    safe_name = slugify(cast.get("name") or cast.get("title") or title)
    eid = cast["eid"]
    metadata_path = output_dir / f"{safe_name}_{eid}.template.json"
    example_path = output_dir / f"{safe_name}_{eid}.example-payload.json"

    example_data = cast.get("exampleData") or {}
    if isinstance(example_data, dict) and "data" in example_data:
        payload = example_data
    else:
        payload = {
            "title": cast.get("title") or title,
            "fontSize": 10,
            "textColor": "#333333",
            "data": example_data if isinstance(example_data, dict) else {},
        }

    field_info = cast.get("fieldInfo") or {}
    fields = field_info.get("fields") if isinstance(field_info, dict) else None
    detected_field_count = len(fields) if isinstance(fields, list) else None

    metadata = {
        "templateId": eid,
        "templateName": cast.get("name"),
        "templateTitle": cast.get("title"),
        "hasBeenPublished": cast.get("hasBeenPublished"),
        "publishedNumber": cast.get("publishedNumber"),
        "latestDraftVersionNumber": cast.get("latestDraftVersionNumber"),
        "sourcePdfPath": str(pdf_path),
        "fieldInfo": field_info,
        "detectedFieldCount": detected_field_count,
        "detectors": {
            "detectFields": bool(args.detect_fields),
            "detectBoxesAdvanced": bool(args.detect_boxes_advanced),
            "advancedDetectFields": bool(args.advanced_detect_fields),
            "aliasIds": args.alias_id or None,
        },
        "examplePayloadPath": str(example_path),
    }

    metadata_path.write_text(json.dumps(metadata, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    example_path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    print(f"Template created: {eid}")
    print(f"Template name: {cast.get('name')}")
    print(f"Template title: {cast.get('title')}")
    if detected_field_count is not None:
        print(f"Detected fields: {detected_field_count}")
    print(f"Metadata file: {metadata_path}")
    print(f"Example payload file: {example_path}")
    if detected_field_count == 0:
        print(
            "Warning: no fields detected. For scanned/non-fillable PDFs keep --detect-boxes-advanced enabled.",
            file=sys.stderr,
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
