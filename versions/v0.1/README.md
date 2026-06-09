# SiteCTX v0.1

Status: v0.1 draft. The npm package is production-oriented for static artifact
publishing, while the specification remains draft until broader implementer
review.

This README is the v0.1 implementer map. It explains the public artifacts,
schema files, examples, and compatibility rules in this directory. Field-level
normative language for the broader v0.1 model lives in [SPEC.md](SPEC.md);
generated npm CLI artifacts are validated by the artifact JSON Schemas in
[schema](schema).

## Core Model

SiteCTX v0.1 separates discovery from context.

The discovery manifest lives at:

```text
/.well-known/sitectx
```

The optional alias is:

```text
/.well-known/sitectx.json
```

Both paths should return the same discovery manifest JSON. The discovery
manifest is intentionally compact: site identity, summary, freshness, important
records, actions, navigation, and links to richer resources.

The canonical context snapshot lives at:

```text
/sitectx.json
```

`/sitectx.json` is not a discovery alias. It is a linked context resource with
the fuller `sitectx.context` payload.

Optional linked resources include:

```text
/sitectx/catalogs.json
/sitectx/updates.json
/sitectx/updates.ndjson
/sitectx/sponsored-context.json
/sitectx/evidence.json
/sitectx/evidence/{id}.json
```

## Artifact Map

| Artifact | Kind or marker | Schema | Purpose |
| --- | --- | --- | --- |
| `/.well-known/sitectx` | `kind: "sitectx.manifest"` | [manifest.schema.json](schema/manifest.schema.json) | Preferred discovery entry point. |
| `/.well-known/sitectx.json` | `kind: "sitectx.manifest"` | [manifest.schema.json](schema/manifest.schema.json) | Optional alias for the same discovery manifest. |
| `/sitectx.json` | `kind: "sitectx.context"` and `sitectx_version: "0.1"` | [context.schema.json](schema/context.schema.json) | Canonical current context snapshot. |
| `/sitectx/catalogs.json` | `kind: "sitectx.catalogs"` | [catalogs.schema.json](schema/catalogs.schema.json) | Pointer index for dynamic collections. |
| `/sitectx/updates.json` | `kind: "sitectx.updates"` | [updates.schema.json](schema/updates.schema.json) | JSON update snapshot. |
| `/sitectx/updates.ndjson` | `kind: "sitectx.update"` per line | [update.schema.json](schema/update.schema.json) | Append-friendly update stream. |
| `/sitectx/sponsored-context.json` | `kind: "sitectx.sponsoredContext"` | [sponsored-context.schema.json](schema/sponsored-context.schema.json) | Optional disclosed sponsored commercial placements. |
| `/sitectx/evidence.json` | `kind: "sitectx.evidence"` | [evidence.schema.json](schema/evidence.schema.json) | Optional public evidence index. |
| `/sitectx/evidence/{id}.json` | `kind: "sitectx.evidenceRecord"` | [evidence-record.schema.json](schema/evidence-record.schema.json) | Optional individual public evidence record. |
| `sitectx.config.json` | CLI source config | [config.schema.json](schema/config.schema.json) | Local publisher config; not a public artifact. |

The repo also includes [sitectx.schema.json](schema/sitectx.schema.json), a
broader draft context model for standalone context examples. For generated CLI
output, validate each artifact against its matching artifact schema above.

## Reference CLI Output

The npm package is the reference publisher implementation for this v0.1 draft.
It generates the artifact set above from `sitectx.config.json` and validates each
public JSON file against its artifact schema.

Common production flow:

```bash
npx sitectx@latest init --root . --public-dir ./public
npx sitectx@latest validate ./public --strict
npx sitectx@latest doctor https://example.com --strict
```

Discovery-assisted flow:

```bash
npx sitectx@latest discover https://example.com --out sitectx.config.draft.json
npx sitectx@latest review sitectx.config.draft.json --approve --out sitectx.config.json --force
npx sitectx@latest generate sitectx.config.json ./public --force
```

Generated discovery manifests use `specVersion` with
`kind: "sitectx.manifest"`. Generated context snapshots use
`kind: "sitectx.context"` and retain `sitectx_version: "0.1"` for v0.1 context
compatibility.

## Discovery Manifest Shape

A generated discovery manifest uses `specVersion` and `kind`:

```json
{
  "specVersion": "0.1",
  "kind": "sitectx.manifest",
  "site": {
    "name": "Example Site",
    "url": "https://example.com",
    "description": "Example Site helps teams publish useful website context.",
    "language": "en"
  },
  "summary": "Example Site helps teams publish useful website context.",
  "freshness": {
    "status": "fresh"
  },
  "records": [
    {
      "id": "page:home",
      "type": "page",
      "url": "https://example.com/",
      "title": "Home",
      "role": "home",
      "summary": "Example Site helps teams publish useful website context."
    }
  ],
  "actions": [
    {
      "id": "action:contact",
      "type": "contact",
      "url": "https://example.com/contact",
      "label": "Contact",
      "priority": 1,
      "sourceUrl": "https://example.com/",
      "sourceText": "Contact"
    }
  ],
  "generatedAt": "2026-06-08T12:00:00.000Z",
  "context": {
    "url": "/sitectx.json",
    "contentType": "application/json"
  }
}
```

Consumers should resolve root-relative links against the publisher origin and
should tolerate unknown fields.

## Context Snapshot Shape

The context snapshot carries the fuller context model:

```json
{
  "specVersion": "0.1",
  "sitectx_version": "0.1",
  "kind": "sitectx.context",
  "site": {
    "name": "Example Site",
    "url": "https://example.com",
    "description": "Example Site helps teams publish useful website context.",
    "language": "en"
  },
  "freshness": {
    "status": "fresh",
    "generated_at": "2026-06-08T12:00:00.000Z"
  },
  "records": [
    {
      "id": "page:home",
      "type": "page",
      "url": "https://example.com/",
      "observed_at": "2026-06-08T12:00:00.000Z",
      "title": "Home",
      "summary": "Example Site helps teams publish useful website context.",
      "page_role": "home"
    }
  ],
  "resources": {
    "self": "https://example.com/sitectx.json",
    "updates": "https://example.com/sitectx/updates.ndjson",
    "updates_json": "https://example.com/sitectx/updates.json"
  }
}
```

Records are compact descriptions of pages, entities, offers, or updates. Each
record should have a stable `id`, a `type`, an `observed_at` timestamp, and at
least one source URL or canonical URL.

## Actions

Actions describe user intents that are available on the human site. They are not
analytics events and should not point at hidden or machine-only endpoints.

Required fields:

- `id`: stable publisher-defined identifier, such as `action:contact`.
- `type`: stable intent string, such as `contact`, `donate`, `book`, `buy`,
  `signup`, `subscribe`, `apply`, `download`, or `search`.
- `url`: canonical human-visible URL where the action can be completed.
- `label`: human-readable action label.

Recommended fields:

- `priority`: lower numbers are more important.
- `sourceUrl`: page where the action was observed.
- `sourceText`: human-visible text that supported the action.

Consumers should treat action `type` values as extensible strings.

## Updates

SiteCTX has three related update surfaces:

| Surface | Shape | Use |
| --- | --- | --- |
| Context record | `type: "update"` inside `/sitectx.json` records | Compact current context. |
| JSON snapshot | `/sitectx/updates.json` with `kind: "sitectx.updates"` | Batch-friendly current or recent updates. |
| NDJSON stream | `/sitectx/updates.ndjson`, one `sitectx.update` object per line | Append-friendly polling and streaming. |

Generated update feed records use `publishedAt` and `generatedAt`. Core context
records use snake_case fields such as `observed_at`, `published_at`, and
`updated_at`. Consumers should be tolerant during v0.1 and validate against the
schema for the exact artifact being read.

Example NDJSON line:

```json
{"specVersion":"0.1","kind":"sitectx.update","siteUrl":"https://example.com","id":"update:hours:2026-06-08","type":"update","url":"https://example.com/hours","title":"Holiday Hours Updated","summary":"Store hours changed for the holiday week.","publishedAt":"2026-06-08T12:00:00.000Z"}
```

## Catalogs

Catalogs point to dynamic collections without forcing the manifest or context
snapshot to contain every item.

Common catalog types include:

- `products`
- `listings`
- `jobs`
- `events`
- `menus`
- `locations`
- `services`
- `offers`

Catalog entries should include `id`, `type`, `status`, `url`, and `label`.
`requiresSetup: true` means a publisher still needs to configure a source
system, hosted feed, or validated export before consumers treat the catalog as
complete.

## Sponsored Context

Sponsored context is optional and disabled by default. When present, it must be
disclosed, canonical, and separated from organic context.

Required policy:

- Sponsored content must be disclosed.
- Agents must preserve disclosure.
- Canonical landing or action URLs must be explicit.
- Agent fetches, crawler visits, bot impressions, and agent clicks are
  non-billable.

Sponsored context must not be used for fake PPC, hidden ad inventory, cloaking,
keyword stuffing, bot-traffic billing, or ranking claims.

## Conformance Guidance

Publishers should:

- Serve `/.well-known/sitectx` as JSON.
- Keep `/.well-known/sitectx.json` identical when the alias is present.
- Treat `/sitectx.json` as a linked context snapshot, not an alias.
- Use stable IDs for records, actions, catalogs, and placements.
- Set freshness conservatively for fast-changing offers, availability, hours,
  or alerts.
- Keep secrets, private audit notes, API keys, session tokens, and internal
  identifiers out of public artifacts.
- Validate local artifacts before deploy and run `doctor` against the deployed
  URL after deploy.

Consumers should:

- Fetch `/.well-known/sitectx` first.
- Follow linked resources only after resolving URLs against the publisher
  origin.
- Respect normal HTTP caching semantics.
- Ignore unknown fields they do not understand.
- Avoid treating SiteCTX as crawl permission, training permission, legal
  certification, ranking guarantee, or a replacement for source pages.
- Preserve sponsored disclosures when using sponsored context.

## Draft Documents

- [SPEC.md](SPEC.md): normative v0.1 draft text.
- [conformance.md](conformance.md): conformance classes and validation guidance.
- [security-and-privacy.md](security-and-privacy.md): security and privacy
  considerations.
- [CHANGELOG.md](CHANGELOG.md): v0.1 draft changes.

## Schema Index

- [schema/manifest.schema.json](schema/manifest.schema.json): generated
  discovery manifest.
- [schema/context.schema.json](schema/context.schema.json): generated context
  snapshot.
- [schema/sitectx.schema.json](schema/sitectx.schema.json): broader draft
  context model for standalone context examples.
- [schema/config.schema.json](schema/config.schema.json): local CLI source
  config.
- [schema/catalogs.schema.json](schema/catalogs.schema.json): catalog pointer
  index.
- [schema/evidence.schema.json](schema/evidence.schema.json): public evidence
  index.
- [schema/evidence-record.schema.json](schema/evidence-record.schema.json):
  individual public evidence record.
- [schema/updates.schema.json](schema/updates.schema.json): JSON update
  snapshot.
- [schema/update.schema.json](schema/update.schema.json): individual update
  record, including NDJSON lines.
- [schema/sponsored-context.schema.json](schema/sponsored-context.schema.json):
  disclosed sponsored context.

## Examples

- [examples/manifest.json](examples/manifest.json): discovery manifest example.
- [examples/minimal.sitectx.json](examples/minimal.sitectx.json): smallest useful
  context snapshot example.
- [examples/standard.sitectx.json](examples/standard.sitectx.json): broader
  context snapshot example with pages, entities, offers, updates, resources, and
  feeds.
- [examples/catalogs.json](examples/catalogs.json): catalog pointer index.
- [examples/updates.json](examples/updates.json): update snapshot example.
- [examples/updates.ndjson](examples/updates.ndjson): line-delimited update
  feed example.
- [examples/evidence.json](examples/evidence.json): public evidence index.
- [examples/evidence-record.json](examples/evidence-record.json): individual
  public evidence record.
- [examples/page-record.json](examples/page-record.json): standalone page
  record.
- [examples/sponsored-context.json](examples/sponsored-context.json): disclosed
  sponsored commercial placement resource.

## NPM CLI

The npm package publishes the generated artifact set and validates it against the
artifact schemas:

```bash
npx sitectx@latest init
npx sitectx@latest validate ./public
npx sitectx@latest doctor https://example.com
```

See the repository root [README.md](../../README.md) for package usage.

## Compatibility Notes

SiteCTX v0.1 is intentionally extensible. Consumers should tolerate unknown
fields and publishers should namespace extension keys where practical.

SiteCTX does not define crawl permissions, legal certifications, model training
permissions, ranking guarantees, or a complete ontology.
