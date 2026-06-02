# SiteCTX v0.1 Conformance

This document describes conformance expectations for SiteCTX v0.1 publishers,
consumers, and validators.

The keywords `MUST`, `MUST NOT`, `SHOULD`, `SHOULD NOT`, and `MAY` are
interpreted as RFC 2119 keywords when they appear in uppercase.

## Publisher Conformance

A conforming v0.1 publisher:

- MUST publish a JSON object as the SiteCTX manifest.
- MUST include the top-level fields `sitectx_version`, `site`, `freshness`, and
  `records`.
- MUST set `sitectx_version` to the string `"0.1"`.
- MUST include `freshness.status` and `freshness.generated_at`.
- MUST use one of `fresh`, `stale`, `unknown`, or `error` for
  `freshness.status`.
- MUST ensure each record includes `id`, `type`, `observed_at`, and at least one
  of `url` or `source_url`.
- MUST use only `page`, `entity`, `offer`, or `update` for v0.1 record types.
- SHOULD publish the manifest at `/.well-known/sitectx`.
- MAY also publish the same manifest at `/.well-known/sitectx.json`.
- MAY publish the current context snapshot at `/sitectx.json`; this path is not
  a manifest alias.
- MAY include the optional top-level `resources` object to link to update feeds,
  update snapshots, and public evidence indexes.
- SHOULD serve the manifest as `application/json` where practical.
- SHOULD use RFC 3339-compatible date-time strings for timestamps.
- SHOULD include source URLs that allow consumers to verify or understand record
  claims.
- SHOULD namespace extension keys where practical.

Publisher conformance does not certify that records are legally authoritative,
complete, unbiased, ranked, or suitable for any particular automated use.

## Publisher Profiles

Minimal conformance requires only a valid v0.1 manifest with the required
top-level fields and valid records. It does not require `resources`, update
feeds, evidence indexes, or evidence records.

Standard conformance SHOULD validate `resources` URLs when the `resources`
object is present. Standard publishers SHOULD use the preferred discovery
endpoint and SHOULD keep optional aliases consistent when they are published.

Operational conformance SHOULD verify that linked resources are reachable when
they are declared. This includes declared update feeds, JSON update snapshots,
public evidence indexes, and individual public evidence records that the
publisher chooses to expose.

## Consumer Conformance

A conforming v0.1 consumer:

- MUST be able to retrieve or process a JSON manifest that follows the required
  v0.1 structure.
- MUST interpret `sitectx_version: "0.1"` according to the v0.1 specification.
- MUST tolerate unknown top-level and record fields.
- MUST NOT reject an otherwise valid manifest solely because it contains
  extension fields.
- MUST NOT treat SiteCTX as crawl permission, legal certification, model
  training permission, or a ranking guarantee.
- SHOULD respect HTTP caching metadata.
- SHOULD treat freshness status and timestamps as publisher-provided claims, not
  independent proof.
- SHOULD validate URLs and fetched resources using normal security controls.

Consumers MAY apply stricter local policy for their own systems, including
source allowlists, size limits, fetch limits, or trust requirements.

## Validator Conformance

A v0.1 validator SHOULD check:

- JSON syntax.
- Required top-level fields.
- `sitectx_version` value.
- Required freshness fields and allowed status values.
- Required record fields.
- Record `type` enumeration.
- The requirement that each record include at least one of `url` or
  `source_url`.
- Timestamp strings where practical.
- Known `resources` URLs when the optional `resources` object is present.

A validator SHOULD NOT fail a manifest solely because it contains unknown fields.
Validators MAY provide warnings for non-namespaced extension keys, relative URLs,
missing source URLs, or other quality issues that are not hard v0.1 errors.

## Compatibility Profile

The v0.1 compatibility profile is additive. Publishers can add fields, and
consumers are expected to ignore fields they do not understand. Changes that
remove required fields, change required field meanings, or reinterpret record
types are not compatible with v0.1.
