# SiteCTX

SiteCTX is a CLI for publishing machine-readable website context with
deterministic discovery, validation, and human review gates.

Run SiteCTX once, generate the files, review them, and ship them with your site.
No package install is required in the app you are publishing.

SiteCTX creates a validated `/.well-known/sitectx` manifest, canonical site
context, freshness metadata, reviewable updates, actions, navigation, profile
links, and catalog pointers for AI systems and internal tools.

## Zero-Install Quick Start

```bash
npx sitectx@latest init
npx sitectx@latest validate .
npx sitectx@latest doctor .
npx sitectx@latest inspect .
```

In an interactive terminal, `init` asks for the site URL and output location,
discovers the site, shows what it found, writes the files, and validates them.

## Vertical Presets

Use a preset when you already know the kind of site. Presets tune discovery so
SiteCTX spends its limited crawl budget on the pages, actions, and catalog
signals that matter for that vertical.

```bash
npx sitectx@latest init --preset ecommerce
npx sitectx@latest init --preset nonprofit
npx sitectx@latest init --preset saas
npx sitectx@latest init --preset local-business
npx sitectx@latest init --preset docs
```

The same presets work in the advanced draft workflow:

```bash
npx sitectx@latest discover https://example.com --preset ecommerce
```

## Existing App

For a Next.js, Vite, Astro, or static app with a `public/` directory:

```bash
npx sitectx@latest init --root . --public-dir ./public
```

When SiteCTX detects `./public`, generated public files go there so the app can
serve:

```text
/.well-known/sitectx
/.well-known/sitectx.json
/sitectx.json
/sitectx/catalogs.json
/sitectx/updates.json
/sitectx/updates.ndjson
```

The source config stays in the app root:

```text
sitectx.config.json
```

SiteCTX does not mutate `package.json`, create `node_modules`, or write a package
lock during `init`.

## Localhost Discovery

Start your app:

```bash
npm run dev
```

Discover the running site:

```bash
npx sitectx@latest discover http://localhost:3000 --max-pages 25 --max-depth 2
```

This writes:

```text
sitectx.config.draft.json
```

Discovery drafts are review-required by default. A normal generate command will
fail until the draft is reviewed:

```bash
npx sitectx@latest review sitectx.config.draft.json
```

The review flow lets you approve or edit the discovered summary, actions,
navigation, catalogs, and source pages before publishing.

```bash
npx sitectx@latest generate sitectx.config.draft.json ./public
```

To generate from an unreviewed draft during testing, be explicit:

```bash
npx sitectx@latest generate sitectx.config.draft.json ./public --allow-draft --force
```

If you use a localhost URL, SiteCTX accepts it for development and warns you to
replace `site.url` with the production URL before publishing.

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

## What Gets Generated

Public files:

```text
.well-known/sitectx
.well-known/sitectx.json
sitectx.json
sitectx/catalogs.json
sitectx/updates.json
sitectx/updates.ndjson
```

Local source config:

```text
sitectx.config.json
```

The manifest at `/.well-known/sitectx` is the entry point. It includes site
identity, summary, freshness, important pages, user actions, navigation, and
links to the canonical context, catalog index, and update feeds.

Actions tell systems what users can do:

```json
{
  "id": "action:contact",
  "type": "contact",
  "url": "https://example.com/contact",
  "label": "Contact",
  "priority": 1
}
```

Navigation tells systems how the site presents itself:

```json
{
  "label": "Products",
  "url": "https://example.com/products",
  "role": "products"
}
```

Catalogs point to dynamic inventory, listings, offers, or external commerce
systems without crawling every item:

```json
{
  "id": "catalog:shopify-products",
  "type": "products",
  "status": "detected",
  "source": "shopify",
  "url": "https://example.com/products.json",
  "label": "Shopify product catalog",
  "requiresSetup": false
}
```

## Sponsored Context

Sponsored Context lets a site publish disclosed, machine-readable commercial
placements for agents and automated systems. It is not a click-fraud,
bot-impression, cloaking, keyword-stuffing, or ranking mechanism. Automated
fetches, crawler visits, bot impressions, and agent clicks must not be
represented as human ad engagement.

Sponsored Context is disabled by default. Enable it only when you intentionally
want to publish disclosed commercial placements:

```bash
npx sitectx@latest sponsor init --enable
npx sitectx@latest sponsor add \
  --name "Price Papertrail" \
  --url "https://pricepapertrail.com" \
  --title "Defensible records for pricing changes" \
  --summary "Create evidence packets for pricing page changes, reviews, and decisions." \
  --category "compliance_software" \
  --price "$250/month" \
  --currency "USD" \
  --valid-until "2026-07-04" \
  --canonical-action-url "https://pricepapertrail.com/pilot" \
  --canonical-action-label "Request pilot" \
  --relationship "paid_placement"
npx sitectx@latest sponsor validate
npx sitectx@latest sponsor build --force
```

When enabled, SiteCTX writes:

```text
/sitectx/sponsored-context.json
```

and links it from the manifest and context with a `commercialContext` policy.
The file uses disclosed placements:

```json
{
  "id": "spn_example_001",
  "type": "sponsored_offer",
  "status": "active",
  "sponsor": {
    "name": "Example Sponsor",
    "url": "https://sponsor.example"
  },
  "disclosure": {
    "label": "Sponsored",
    "relationship": "paid_placement",
    "plainLanguage": "This is a paid placement from Example Sponsor."
  },
  "canonicalAction": {
    "label": "Request pilot",
    "url": "https://sponsor.example/pilot",
    "actionType": "lead_form"
  },
  "measurement": {
    "billableEvents": [
      "sponsored_listing_active",
      "verified_human_lead",
      "qualified_conversion"
    ],
    "nonBillableEvents": [
      "agent_fetch",
      "agent_click",
      "crawler_visit",
      "bot_impression"
    ]
  }
}
```

Validation fails if a sponsored placement lacks disclosure, sponsor identity, a
canonical action URL, valid dates, or marks automated agent, crawler, bot,
click, fetch, visit, or impression events as billable. Validation warns on weak
evidence, missing human-visible disclosure references, domain mismatches, long
summaries, and relevant-query stuffing.

Non-goals:

- Not fake PPC.
- Not hidden ad inventory.
- Not SEO keyword stuffing.
- Not a ranking guarantee.
- Not a way to bill advertisers for bot traffic.

## Review Gate

`discover` writes a review-required draft:

```json
{
  "discovery": {
    "status": "draft_review_required"
  }
}
```

`generate` refuses that draft by default. Review the config and set
`discovery.status` to `"reviewed"` with `sitectx review`, or pass
`--allow-draft` when you intentionally want to generate test artifacts.

```bash
npx sitectx@latest review sitectx.config.draft.json
```

## No Install Required

The public workflow is:

```bash
npx sitectx@latest ...
```

Teams that want pinned repeatable scripts can add SiteCTX as a local dev
dependency, but that is optional and not required for publishing.

## Troubleshooting

Localhost server not running:
`discover`, `doctor`, or `inspect` will fail cleanly if
`http://localhost:3000` is not reachable. Start the app first with `npm run dev`.

Existing files:
Interactive `init` asks before overwriting. Non-interactive runs require
`--force`.

Invalid URL:
Use `http://` or `https://`. Localhost URLs such as
`http://localhost:3000` and `http://127.0.0.1:3000` are valid for development.

Missing public directory:
Pass `--public-dir ./public` for app output. If no public directory is detected,
SiteCTX writes to the selected root.

Draft config needs review:
Run `review sitectx.config.draft.json` before generate. Use
`generate sitectx.config.draft.json ./public --allow-draft --force` only for
test generation.

## Common Commands

```bash
npx sitectx@latest init
npx sitectx@latest init --preset ecommerce
npx sitectx@latest discover http://localhost:3000 --max-pages 25 --max-depth 2
npx sitectx@latest review sitectx.config.draft.json
npx sitectx@latest generate sitectx.config.draft.json ./public --force
npx sitectx@latest sponsor init --enable
npx sitectx@latest sponsor validate
npx sitectx@latest sponsor build --force
npx sitectx@latest validate ./public
npx sitectx@latest doctor ./public
npx sitectx@latest inspect ./public
npx sitectx@latest version
```

## Specification

The current draft is [SiteCTX v0.1](versions/v0.1/README.md).

Repository references:

- [versions/v0.1/SPEC.md](versions/v0.1/SPEC.md)
- [versions/v0.1/schema/sitectx.schema.json](versions/v0.1/schema/sitectx.schema.json)
- [versions/v0.1/schema/catalogs.schema.json](versions/v0.1/schema/catalogs.schema.json)
- [versions/v0.1/schema/sponsored-context.schema.json](versions/v0.1/schema/sponsored-context.schema.json)
- [versions/v0.1/examples](versions/v0.1/examples)
- [versions/v0.1/examples/sponsored-context.json](versions/v0.1/examples/sponsored-context.json)

## Local Development

```bash
npm install
npm run lint
npm test
npm run check
npm run pack:check
node ./bin/sitectx.js --help
```

Tarball smoke without installing into an app:

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

The Python validator is an optional repository utility for maintaining draft spec
examples and schemas. It is not required for npm users.

## License

MIT. See [LICENSE](LICENSE).
