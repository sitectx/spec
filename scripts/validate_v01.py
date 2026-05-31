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
SCHEMA_PATH = ROOT / "versions/v0.1/schema/sitectx.schema.json"
MANIFEST_EXAMPLES = [
    ROOT / "versions/v0.1/examples/minimal.sitectx.json",
    ROOT / "versions/v0.1/examples/standard.sitectx.json",
]
PAGE_RECORD_EXAMPLE = ROOT / "versions/v0.1/examples/page-record.json"
UPDATES_NDJSON = ROOT / "versions/v0.1/examples/updates.ndjson"
UPDATES_JSON = ROOT / "versions/v0.1/examples/updates.json"
EVIDENCE_INDEX_JSON = ROOT / "versions/v0.1/examples/evidence.json"
EVIDENCE_RECORD_JSON = ROOT / "versions/v0.1/examples/evidence-record.json"


def display_path(path: Path) -> str:
    return str(path.relative_to(ROOT))


def load_json(path: Path) -> Any:
    try:
        with path.open("r", encoding="utf-8") as handle:
            return json.load(handle)
    except JSONDecodeError as exc:
        raise RuntimeError(f"{display_path(path)}: invalid JSON: {exc}") from exc


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


def validate_schema(schema: dict[str, Any]) -> bool:
    try:
        Draft202012Validator.check_schema(schema)
    except SchemaError as exc:
        print("FAIL schema is not a valid JSON Schema")
        print(f"  - {exc.message}")
        return False
    print(f"PASS schema syntax: {display_path(SCHEMA_PATH)}")
    return True


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


def require_fields(
    instance: dict[str, Any], fields: list[str], prefix: str = "$"
) -> list[str]:
    return [
        f"{prefix}: missing required field {field!r}"
        for field in fields
        if field not in instance
    ]


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

    errors: list[str] = []
    if not isinstance(instance, dict):
        errors.append("$: expected JSON object")
        print_basic_errors("updates snapshot", path, errors)
        return False

    errors.extend(
        require_fields(instance, ["sitectx_version", "site", "generated_at", "updates"])
    )
    if instance.get("sitectx_version") != "0.1":
        errors.append("$['sitectx_version']: expected '0.1'")

    updates = instance.get("updates")
    if not isinstance(updates, list):
        errors.append("$['updates']: expected array")
    elif not updates:
        errors.append("$['updates']: expected at least one update record")
    else:
        for index, record in enumerate(updates):
            if not isinstance(record, dict):
                errors.append(f"$['updates'][{index}]: expected object")
                continue

            record_errors = collect_errors(validator, record)
            for error in record_errors:
                errors.append(f"$['updates'][{index}]{format_error(error)[1:]}")

            if record.get("type") != "update":
                errors.append(f"$['updates'][{index}]['type']: expected 'update'")
            if record.get("update_type") is None:
                errors.append(
                    f"$['updates'][{index}]: missing required field 'update_type'"
                )
            if not record.get("summary"):
                errors.append(f"$['updates'][{index}]: missing required field 'summary'")

    if errors:
        print_basic_errors("updates snapshot", path, errors)
        return False

    print(f"PASS updates snapshot: {display_path(path)} ({len(updates)} records)")
    return True


def validate_evidence_index(path: Path) -> bool:
    try:
        instance = load_json(path)
    except RuntimeError as exc:
        print("FAIL evidence index")
        print(f"  - {exc}")
        return False

    errors: list[str] = []
    if not isinstance(instance, dict):
        errors.append("$: expected JSON object")
        print_basic_errors("evidence index", path, errors)
        return False

    errors.extend(
        require_fields(instance, ["sitectx_version", "site", "generated_at", "evidence"])
    )
    if instance.get("sitectx_version") != "0.1":
        errors.append("$['sitectx_version']: expected '0.1'")

    evidence = instance.get("evidence")
    if not isinstance(evidence, list):
        errors.append("$['evidence']: expected array")
    elif not evidence:
        errors.append("$['evidence']: expected at least one evidence record reference")
    else:
        for index, item in enumerate(evidence):
            if not isinstance(item, dict):
                errors.append(f"$['evidence'][{index}]: expected object")
                continue
            errors.extend(
                require_fields(
                    item,
                    ["id", "url", "source_url", "observed_at", "summary"],
                    prefix=f"$['evidence'][{index}]",
                )
            )

    if errors:
        print_basic_errors("evidence index", path, errors)
        return False

    print(f"PASS evidence index: {display_path(path)} ({len(evidence)} records)")
    return True


def validate_evidence_record(path: Path) -> bool:
    try:
        instance = load_json(path)
    except RuntimeError as exc:
        print("FAIL evidence record")
        print(f"  - {exc}")
        return False

    errors: list[str] = []
    if not isinstance(instance, dict):
        errors.append("$: expected JSON object")
        print_basic_errors("evidence record", path, errors)
        return False

    errors.extend(
        require_fields(
            instance,
            [
                "sitectx_version",
                "id",
                "site",
                "source_url",
                "observed_at",
                "content_type",
                "summary",
                "hash",
                "related_record_ids",
            ],
        )
    )
    if instance.get("sitectx_version") != "0.1":
        errors.append("$['sitectx_version']: expected '0.1'")

    related_record_ids = instance.get("related_record_ids")
    if not isinstance(related_record_ids, list):
        errors.append("$['related_record_ids']: expected array")
    elif not related_record_ids:
        errors.append(
            "$['related_record_ids']: expected at least one related record id"
        )

    if errors:
        print_basic_errors("evidence record", path, errors)
        return False

    print(f"PASS evidence record: {display_path(path)}")
    return True


def main() -> int:
    try:
        schema = load_json(SCHEMA_PATH)
    except RuntimeError as exc:
        print("FAIL schema")
        print(f"  - {exc}")
        return 1

    if not validate_schema(schema):
        return 1

    manifest_validator = Draft202012Validator(schema, format_checker=FormatChecker())
    record_schema = {
        "$schema": schema.get("$schema"),
        "$id": "https://sitectx.org/versions/v0.1/schema/sitectx-record.schema.json",
        "$ref": "#/$defs/record",
        "$defs": schema["$defs"],
    }
    record_validator = Draft202012Validator(
        record_schema, format_checker=FormatChecker()
    )

    ok = True
    for path in MANIFEST_EXAMPLES:
        ok = validate_json_file(path, manifest_validator, "manifest") and ok

    ok = validate_json_file(PAGE_RECORD_EXAMPLE, record_validator, "record") and ok
    ok = validate_updates_feed(UPDATES_NDJSON, record_validator) and ok
    ok = validate_updates_snapshot(UPDATES_JSON, record_validator) and ok
    ok = validate_evidence_index(EVIDENCE_INDEX_JSON) and ok
    ok = validate_evidence_record(EVIDENCE_RECORD_JSON) and ok

    if ok:
        print("PASS SiteCTX v0.1 validation complete")
        return 0

    print("FAIL SiteCTX v0.1 validation failed")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
