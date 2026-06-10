# SiteCTX

SiteCTX is a draft web specification and npm CLI for publishing
machine-readable website context.

The npm package is the reference publisher implementation for SiteCTX v0.1. It
writes a small set of public JSON artifacts that automated systems can fetch
predictably: a discovery manifest, a canonical context snapshot, update feeds,
catalog pointers, user actions, navigation, and optional disclosed sponsored
context.

Use SiteCTX as a publishing tool. The website you publish does not need to
install SiteCTX, import it at runtime, or ship `node_modules`.

SiteCTX is designed for production static publishing: generate the artifacts
locally or in CI, serve them from your existing site, validate before deploy, and
run a deployed doctor check after release.

## What Problem Does SiteCTX Solve?

Most automated systems learn about a website by crawling pages and guessing.
That works poorly for actions, freshness, catalogs, important pages, and
commercial disclosures.

SiteCTX lets a site publish a reviewed context bundle:

- who the site is
- what the site is about
- important pages and actions
- recent updates
- catalog pointers
- optional disclosed sponsored context

The output is static JSON that your existing site can serve from
`/.well-known/sitectx` and `/sitectx.json`.

## Requirements

- Node.js 20.19 or newer.
- A site root or public directory where static files can be written.

## Quick Start

```bash
npx sitectx@latest init --root . --public-dir ./public
npx sitectx@latest validate ./public
npx sitectx@latest doctor ./public
npx sitectx@latest inspect ./public
```

In an interactive terminal, `init` asks for the site URL and output location,
discovers useful site signals, writes the files, and validates them.
If you initialize into `./public`, validate `./public`, not the app root.

## Existing App

For a Next.js, Vite, Astro, or static app with a `public/` directory:

```bash
npx sitectx@latest init --root . --public-dir ./public
npx sitectx@latest validate ./public
npx sitectx@latest doctor ./public
npx sitectx@latest inspect ./public
```

Generated public files go under `./public` so the app can serve them. The local
source config stays at the project root:

```text
sitectx.config.json
```

`init` does not mutate `package.json`, create `node_modules`, or write a package
lock.

## What Gets Published

| Path | Role |
| --- | --- |
| `/.well-known/sitectx` | Preferred discovery manifest. This is the entry point consumers fetch first. |
| `/.well-known/sitectx.json` | Optional alias for the same discovery manifest. |
| `/sitectx.json` | Canonical context snapshot. This is linked from the discovery manifest; it is not a manifest alias. |
| `/sitectx/catalogs.json` | Catalog pointer index for dynamic collections such as products, listings, jobs, events, menus, locations, services, or offers. |
| `/sitectx/updates.json` | JSON snapshot of current or recent updates. |
| `/sitectx/updates.ndjson` | Newline-delimited update stream, one update object per line. |
| `/sitectx/sponsored-context.json` | Optional disclosed sponsored context resource, only when intentionally enabled. |

The local `sitectx.config.json` is publisher source data. Do not serve it unless
you intentionally want to expose it.

## Production Flow

Use `init` for first publication, then keep `sitectx.config.json` under normal
source control and regenerate artifacts during release:

```bash
npx sitectx@latest init --root . --public-dir ./public
npx sitectx@latest validate ./public --strict
```

After deploy, verify the public endpoint rather than only the local files:

```bash
npx sitectx@latest doctor https://example.com --strict
npx sitectx@latest inspect https://example.com --json
```

For discovered configs, publish only after review:

```bash
npx sitectx@latest discover https://example.com --out sitectx.config.draft.json
npx sitectx@latest review sitectx.config.draft.json --approve --out sitectx.config.json --force
npx sitectx@latest generate sitectx.config.json ./public --force
```

## Discovery Manifest

The discovery manifest is compact and points to the rest of the SiteCTX output:

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
  },
  "updatesNdjson": {
    "url": "/sitectx/updates.ndjson",
    "contentType": "application/x-ndjson"
  }
}
```

Actions describe user intents available on the site. They should point to
human-visible URLs and use stable IDs such as `action:contact`, `action:donate`,
`action:book`, `action:buy`, `action:signup`, or `action:subscribe`.

## Discovery and Review

For a running local site:

```bash
npm run dev
npx sitectx@latest discover http://localhost:3000 --max-pages 25 --max-depth 2
```

This writes:

```text
sitectx.config.draft.json
```

Discovery drafts are review-required by default. `generate` refuses an
unreviewed draft unless you explicitly pass `--allow-draft`.

Review the discovered summary, actions, navigation, catalogs, and source pages:

```bash
npx sitectx@latest review sitectx.config.draft.json
npx sitectx@latest generate sitectx.config.draft.json ./public --force
```

For test-only generation from an unreviewed draft:

```bash
npx sitectx@latest generate sitectx.config.draft.json ./public --allow-draft --force
```

Localhost URLs are accepted for development. Replace `siteUrl` with the
production URL before publishing.

## Vertical Presets

Presets tune discovery so SiteCTX spends its limited crawl budget on the pages,
actions, and catalog signals that matter for a site type.

```bash
npx sitectx@latest init --preset ecommerce
npx sitectx@latest init --preset nonprofit
npx sitectx@latest init --preset saas
npx sitectx@latest init --preset local-business
npx sitectx@latest init --preset docs
```

The same presets work with discovery:

```bash
npx sitectx@latest discover https://example.com --preset ecommerce
```

## Validate Before Deploy

```bash
npx sitectx@latest validate ./public
npx sitectx@latest doctor ./public
npx sitectx@latest inspect ./public
```

After deployment:

```bash
npx sitectx@latest doctor https://example.com
npx sitectx@latest inspect https://example.com
```

Use `--strict` with `validate` or `doctor` when warnings should fail CI.

## Sponsored Context

Sponsored context is disabled by default. Enable it only when you intentionally
want to publish disclosed commercial placements.

```bash
npx sitectx@latest sponsor init --enable
npx sitectx@latest sponsor add \
  --name "Price Papertrail" \
  --url "https://pricepapertrail.com" \
  --title "Defensible records for pricing changes" \
  --summary "Create evidence packets for pricing page changes, reviews, and decisions." \
  --category "compliance_software" \
  --price '$250/month' \
  --currency "USD" \
  --valid-until "2026-07-04" \
  --canonical-action-url "https://pricepapertrail.com/pilot" \
  --canonical-action-label "Request pilot" \
  --relationship "paid_placement"
npx sitectx@latest sponsor validate
npx sitectx@latest sponsor build --force
```

Policy guardrails:

- Sponsored content must be disclosed.
- Canonical action URLs must be explicit.
- Agent fetches, crawler visits, bot impressions, and agent clicks are
  non-billable.
- Sponsored context is not fake PPC, hidden ad inventory, cloaking, keyword
  stuffing, or a ranking guarantee.

## Common Commands

```bash
npx sitectx@latest init
npx sitectx@latest init --root . --public-dir ./public
npx sitectx@latest init --preset ecommerce
npx sitectx@latest discover http://localhost:3000 --max-pages 25 --max-depth 2
npx sitectx@latest review sitectx.config.draft.json
npx sitectx@latest generate sitectx.config.draft.json ./public --force
npx sitectx@latest sponsor init --enable
npx sitectx@latest sponsor validate
npx sitectx@latest sponsor build --force
npx sitectx@latest validate ./public
npx sitectx@latest doctor https://example.com
npx sitectx@latest inspect https://example.com
npx sitectx@latest version
```

The npm package exposes the `sitectx` CLI. It is not a runtime SDK.

## Troubleshooting

Localhost server not running:
`discover`, `doctor`, or `inspect` will fail cleanly if
`http://localhost:3000` is not reachable. Start the app first with
`npm run dev`.

Existing files:
Interactive `init` asks before overwriting. Non-interactive generation requires
`--force`.

Invalid URL:
Use `http://` or `https://`. Localhost URLs such as
`http://localhost:3000` and `http://127.0.0.1:3000` are valid for development.

Missing public directory:
Pass `--public-dir ./public` for app output. If no public directory is detected,
SiteCTX writes to the selected root.

Command says no SiteCTX artifacts found:
If `init` wrote public artifacts into `./public`, run the command against that
public output directory:

```bash
npx sitectx@latest validate ./public
npx sitectx@latest doctor ./public
npx sitectx@latest inspect ./public
```

The app root usually contains `sitectx.config.json`; the published JSON files
live under the public output directory.

Draft config needs review:
Run `review sitectx.config.draft.json` before `generate`. Use
`--allow-draft` only for test generation.

## Specification

The current draft is [SiteCTX v0.1](versions/v0.1/README.md).

Useful references:

- [v0.1 implementer README](versions/v0.1/README.md)
- [v0.1 draft specification](versions/v0.1/SPEC.md)
- [discovery manifest schema](versions/v0.1/schema/manifest.schema.json)
- [context snapshot schema](versions/v0.1/schema/context.schema.json)
- [catalog schema](versions/v0.1/schema/catalogs.schema.json)
- [evidence index schema](versions/v0.1/schema/evidence.schema.json)
- [evidence record schema](versions/v0.1/schema/evidence-record.schema.json)
- [update snapshot schema](versions/v0.1/schema/updates.schema.json)
- [sponsored context schema](versions/v0.1/schema/sponsored-context.schema.json)
- [examples](versions/v0.1/examples)

## Local Development

```bash
npm install
npm run lint
npm test
npm run check
npm run pack:check
node ./bin/sitectx.js --help
```

Use `npm pack` to produce a fresh package artifact for smoke tests or release
checks. Do not install stale checked-in tarballs.

Tarball smoke test without installing SiteCTX into an app:

```bash
cd /Users/scottmay/Projects/spec
npm test
npm --cache /private/tmp/sitectx-npm-cache pack --pack-destination /private/tmp

TMPDIR="$(mktemp -d /private/tmp/sitectx-zero-install.XXXXXX)"
cd "$TMPDIR"

npm exec --cache /private/tmp/sitectx-npm-cache \
  --package /private/tmp/sitectx-0.1.0.tgz \
  -- sitectx --help
```

The Python validator is an optional repository utility for maintaining draft
examples and schemas. It is not required for npm users.

## License

MIT. See [LICENSE](LICENSE).
