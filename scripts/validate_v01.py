#!/usr/bin/env python3
"""Validate SiteCTX v0.1 examples against the local schema."""

from __future__ import annotations

import json
import sys
from json import JSONDecodeError
from pathlib import Path
from typing import Any

try:
    from jsonschema import Draft202012Validator, FormatChecker
    from jsonschema.exceptions import SchemaError, ValidationError
except ImportError as exc:  # pragma: no cover - exercised only without dev deps
    print("FAIL missing dependency: jsonschema", file=sys.stderr)
    print(
        "Install development dependencies with: "
        "python -m pip install -r requirements-dev.txt",
        file=sys.stderr,
    )
    raise SystemExit(2) from exc


ROOT = Path(__file__).resolve().parents[1]
SCHEMA_DIR = ROOT / "versions/v0.1/schema"
SCHEMA_PATHS = {
    "manifest": SCHEMA_DIR / "manifest.schema.json",
    "context": SCHEMA_DIR / "context.schema.json",
    "sitectx": SCHEMA_DIR / "sitectx.schema.json",
    "catalogs": SCHEMA_DIR / "catalogs.schema.json",
    "evidence": SCHEMA_DIR / "evidence.schema.json",
    "evidenceRecord": SCHEMA_DIR / "evidence-record.schema.json",
    "updates": SCHEMA_DIR / "updates.schema.json",
    "update": SCHEMA_DIR / "update.schema.json",
    "sponsoredContext": SCHEMA_DIR / "sponsored-context.schema.json",
}
MANIFEST_EXAMPLES = [
    ROOT / "versions/v0.1/examples/manifest.json",
]
CONTEXT_EXAMPLES = [
    ROOT / "versions/v0.1/examples/minimal.sitectx.json",
    ROOT / "versions/v0.1/examples/standard.sitectx.json",
]
PAGE_RECORD_EXAMPLE = ROOT / "versions/v0.1/examples/page-record.json"
CATALOGS_JSON = ROOT / "versions/v0.1/examples/catalogs.json"
UPDATES_NDJSON = ROOT / "versions/v0.1/examples/updates.ndjson"
UPDATES_JSON = ROOT / "versions/v0.1/examples/updates.json"
EVIDENCE_INDEX_JSON = ROOT / "versions/v0.1/examples/evidence.json"
EVIDENCE_RECORD_JSON = ROOT / "versions/v0.1/examples/evidence-record.json"
SPONSORED_CONTEXT_JSON = ROOT / "versions/v0.1/examples/sponsored-context.json"


def display_path(path: Path) -> str:
    return str(path.relative_to(ROOT))


def load_json(path: Path) -> Any:
    try:
        with path.open("r", encoding="utf-8") as handle:
            return json.load(handle)
    except JSONDecodeError as exc:
        raise RuntimeError(f"{display_path(path)}: invalid JSON: {exc}") from exc


def load_schemas() -> dict[str, dict[str, Any]]:
    schemas: dict[str, dict[str, Any]] = {}
    for name, path in SCHEMA_PATHS.items():
        try:
            schemas[name] = load_json(path)
        except RuntimeError as exc:
            raise RuntimeError(f"schema {name}: {exc}") from exc
    return schemas


def format_error(error: ValidationError) -> str:
    location = "$"
    if error.absolute_path:
        location += "".join(f"[{part!r}]" for part in error.absolute_path)
    return f"{location}: {error.message}"


def print_errors(label: str, errors: list[ValidationError]) -> None:
    print(f"FAIL {label}")
    for error in errors:
        print(f"  - {format_error(error)}")


def print_basic_errors(label: str, path: Path, errors: list[str]) -> None:
    print(f"FAIL {label}: {display_path(path)}")
    for error in errors:
        print(f"  - {error}")


def collect_errors(
    validator: Draft202012Validator, instance: Any
) -> list[ValidationError]:
    return sorted(validator.iter_errors(instance), key=lambda err: list(err.path))


def validate_schema(name: str, path: Path, schema: dict[str, Any]) -> bool:
    try:
        Draft202012Validator.check_schema(schema)
    except SchemaError as exc:
        print(f"FAIL {name} schema is not a valid JSON Schema")
        print(f"  - {exc.message}")
        return False
    print(f"PASS schema syntax: {display_path(path)}")
    return True


def inline_update_schema(
    updates_schema: dict[str, Any], update_schema: dict[str, Any]
) -> dict[str, Any]:
    schema = json.loads(json.dumps(updates_schema))
    schema["properties"]["updates"]["items"] = update_schema
    return schema


def validate_json_file(
    path: Path, validator: Draft202012Validator, label: str
) -> bool:
    try:
        instance = load_json(path)
    except RuntimeError as exc:
        print(f"FAIL {label}")
        print(f"  - {exc}")
        return False

    errors = collect_errors(validator, instance)
    if errors:
        print_errors(f"{label}: {display_path(path)}", errors)
        return False

    print(f"PASS {label}: {display_path(path)}")
    return True


def validate_updates_feed(path: Path, validator: Draft202012Validator) -> bool:
    ok = True
    records_seen = 0

    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError as exc:
        print(f"FAIL updates feed: {display_path(path)}")
        print(f"  - could not read file: {exc}")
        return False

    for line_number, line in enumerate(lines, start=1):
        if not line.strip():
            continue

        records_seen += 1
        label = f"{display_path(path)} line {line_number}"
        try:
            record = json.loads(line)
        except JSONDecodeError as exc:
            print(f"FAIL update record: {label}")
            print(f"  - invalid JSON: {exc}")
            ok = False
            continue

        errors = collect_errors(validator, record)
        if errors:
            print_errors(f"update record: {label}", errors)
            ok = False

        if record.get("type") != "update":
            print(f"FAIL update record: {label}")
            print("  - expected type to be 'update'")
            ok = False

    if records_seen == 0:
        print(f"FAIL updates feed: {display_path(path)}")
        print("  - expected at least one update record")
        return False

    if ok:
        print(f"PASS updates feed: {display_path(path)} ({records_seen} records)")
    return ok


def validate_updates_snapshot(path: Path, validator: Draft202012Validator) -> bool:
    try:
        instance = load_json(path)
    except RuntimeError as exc:
        print("FAIL updates snapshot")
        print(f"  - {exc}")
        return False

    if not isinstance(instance, dict):
        print_basic_errors("updates snapshot", path, ["$: expected JSON object"])
        return False

    schema_errors = collect_errors(validator, instance)
    if schema_errors:
        print_errors(f"updates snapshot: {display_path(path)}", schema_errors)
        return False

    updates = instance.get("updates")
    if not isinstance(updates, list):
        print_basic_errors("updates snapshot", path, ["$['updates']: expected array"])
        return False
    if not updates:
        print_basic_errors(
            "updates snapshot",
            path,
            ["$['updates']: expected at least one update record"],
        )
        return False

    print(f"PASS updates snapshot: {display_path(path)} ({len(updates)} records)")
    return True


def main() -> int:
    try:
        schemas = load_schemas()
    except RuntimeError as exc:
        print("FAIL schema")
        print(f"  - {exc}")
        return 1

    ok = True
    for name, schema in schemas.items():
        ok = validate_schema(name, SCHEMA_PATHS[name], schema) and ok
    if not ok:
        return 1

    format_checker = FormatChecker()
    manifest_validator = Draft202012Validator(
        schemas["manifest"], format_checker=format_checker
    )
    context_validator = Draft202012Validator(
        schemas["context"], format_checker=format_checker
    )
    sitectx_validator = Draft202012Validator(
        schemas["sitectx"], format_checker=format_checker
    )
    catalogs_validator = Draft202012Validator(
        schemas["catalogs"], format_checker=format_checker
    )
    evidence_validator = Draft202012Validator(
        schemas["evidence"], format_checker=format_checker
    )
    evidence_record_validator = Draft202012Validator(
        schemas["evidenceRecord"], format_checker=format_checker
    )
    update_validator = Draft202012Validator(
        schemas["update"], format_checker=format_checker
    )
    updates_validator = Draft202012Validator(
        inline_update_schema(schemas["updates"], schemas["update"]),
        format_checker=format_checker,
    )
    sponsored_context_validator = Draft202012Validator(
        schemas["sponsoredContext"], format_checker=format_checker
    )
    record_schema = {
        "$schema": schemas["context"].get("$schema"),
        "$id": "https://sitectx.org/versions/v0.1/schema/sitectx-record.schema.json",
        "$ref": "#/$defs/record",
        "$defs": schemas["context"]["$defs"],
    }
    record_validator = Draft202012Validator(
        record_schema, format_checker=format_checker
    )

    for path in MANIFEST_EXAMPLES:
        ok = validate_json_file(path, manifest_validator, "manifest") and ok

    for path in CONTEXT_EXAMPLES:
        ok = validate_json_file(path, context_validator, "context") and ok
        ok = validate_json_file(path, sitectx_validator, "sitectx context") and ok

    ok = validate_json_file(PAGE_RECORD_EXAMPLE, record_validator, "record") and ok
    ok = validate_json_file(CATALOGS_JSON, catalogs_validator, "catalogs") and ok
    ok = validate_updates_feed(UPDATES_NDJSON, update_validator) and ok
    ok = validate_updates_snapshot(UPDATES_JSON, updates_validator) and ok
    ok = validate_json_file(EVIDENCE_INDEX_JSON, evidence_validator, "evidence") and ok
    ok = (
        validate_json_file(
            EVIDENCE_RECORD_JSON,
            evidence_record_validator,
            "evidence record",
        )
        and ok
    )
    ok = (
        validate_json_file(
            SPONSORED_CONTEXT_JSON,
            sponsored_context_validator,
            "sponsored context",
        )
        and ok
    )

    if ok:
        print("PASS SiteCTX v0.1 validation complete")
        return 0

    print("FAIL SiteCTX v0.1 validation failed")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
