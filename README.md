# SiteCTX

SiteCTX is a machine-readable context layer for websites. It lets a site
publish structured, freshness-aware context for automated systems, including
important pages, entities, offers, updates, freshness metadata, resource links,
feed links, public evidence resources, and supporting source URLs.

The current draft is [SiteCTX v0.1](versions/v0.1/README.md).

## What SiteCTX Is

SiteCTX has a required JSON manifest and optional linked update feeds and public
evidence resources. A website can publish the manifest at a predictable
location, preferably:

```text
/.well-known/sitectx
```

The manifest is the required core. It gives automated consumers a compact,
publisher-provided summary of site context while linking back to source pages
that remain the authoritative human and machine-readable web resources.
Publishers may also link to optional update feeds and public evidence resources
from the manifest.

## What SiteCTX Is Not

SiteCTX is not crawler permission control, legal certification, a model training
permission format, a ranking guarantee, a replacement for the website itself, or
a complete semantic web ontology.

Sites should continue to use existing mechanisms such as robots.txt, sitemaps,
HTTP caching, structured data, feeds, and access control for their established
purposes.

## Quick Example

```json
{
  "sitectx_version": "0.1",
  "site": {
    "url": "https://example.com/",
    "name": "Example Site"
  },
  "freshness": {
    "status": "fresh",
    "generated_at": "2026-05-31T14:00:00Z"
  },
  "records": [
    {
      "id": "page:home",
      "type": "page",
      "url": "https://example.com/",
      "observed_at": "2026-05-31T13:58:00Z",
      "title": "Example Site"
    }
  ]
}
```

## Repository Layout

- [versions/v0.1/SPEC.md](versions/v0.1/SPEC.md): draft specification
- [versions/v0.1/conformance.md](versions/v0.1/conformance.md): publisher,
  consumer, and validator conformance guidance
- [versions/v0.1/security-and-privacy.md](versions/v0.1/security-and-privacy.md):
  operational security and privacy considerations
- [versions/v0.1/schema/sitectx.schema.json](versions/v0.1/schema/sitectx.schema.json):
  JSON Schema for the v0.1 manifest
- [versions/v0.1/examples](versions/v0.1/examples): sample manifests, update
  streams, public evidence resources, and record documents

## SiteCTX CLI

This repository includes a Node.js CLI package for creating and checking
SiteCTX artifacts. It is intended as a developer on-ramp for the draft spec and
is not published to npm from this repository.

```bash
npm install
npm test
node ./bin/sitectx.js --help
node ./bin/sitectx.js discover --url https://example.com --out sitectx.config.draft.json
node ./bin/sitectx.js init --root ./demo --site-url https://example.com --name "Example Site"
node ./bin/sitectx.js validate --root ./demo
node ./bin/sitectx.js doctor --root ./demo
node ./bin/sitectx.js inspect --root ./demo
```

The CLI generates these public artifacts:

```text
/.well-known/sitectx
/.well-known/sitectx.json
/sitectx.json
/sitectx/updates.json
/sitectx/updates.ndjson
/sitectx/evidence.json  (optional evidence index)
```

It also creates the local source config:

```text
/sitectx.config.json
```

Available commands:

```bash
node ./bin/sitectx.js init
node ./bin/sitectx.js discover
node ./bin/sitectx.js generate
node ./bin/sitectx.js build
node ./bin/sitectx.js validate
node ./bin/sitectx.js doctor
node ./bin/sitectx.js inspect
node ./bin/sitectx.js version
```

### Discovery Workflow

`sitectx discover` creates a review-required draft config from real pages fetched
from a bounded same-origin crawl:

```bash
node ./bin/sitectx.js discover --url https://example.com --out sitectx.config.draft.json
```

Discovery is deterministic. It does not call AI services, model APIs, browser
automation, `wget`, or `curl`. It extracts source page metadata, short redacted
excerpts, candidate FAQ, candidate claims, source pages, provenance, and
freshness metadata into a draft config. It does not infer canonical truth.
Candidate facts, claims, FAQ, and page summaries are marked for review and stay
under `discoveryCandidates` until a human promotes them.

Review and edit the draft before publishing:

```bash
# review/edit sitectx.config.draft.json first
node ./bin/sitectx.js generate --config sitectx.config.draft.json --out public --force
node ./bin/sitectx.js validate --root public
node ./bin/sitectx.js doctor --root public
```

Unreviewed discovery drafts contain:

```json
{
  "discovery": {
    "status": "draft_review_required"
  }
}
```

`generate` refuses those drafts by default. After review, set
`discovery.status` to `"reviewed"`. A draft can be generated explicitly with
`--allow-draft`, but review is recommended:

```bash
node ./bin/sitectx.js generate --config sitectx.config.draft.json --out public --allow-draft --force
```

Discovery is intended for your own sites or sites you are authorized to inspect.
SiteCTX is not a crawler permission system, model training license, legal
certification, or ranking guarantee.

After npm publication, users will be able to run:

```bash
npx sitectx doctor --url https://example.com
```

Pre-publish package testing:

```bash
npm pack --dry-run
npm pack

TMPDIR="$(mktemp -d)"
cd "$TMPDIR"
npm init -y
npm install /absolute/path/to/sitectx-0.1.0.tgz
npx sitectx --help
npx sitectx init --root ./demo --site-url https://example.com --name "Example Site" --force
npx sitectx validate --root ./demo
npx sitectx doctor --root ./demo
npx sitectx inspect --root ./demo
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) and [GOVERNANCE.md](GOVERNANCE.md) before
opening an Issue, Discussion, or pull request. Proposals and pull requests must
follow the human-accountable contribution process. Maintainers should also
review [GITHUB_LAUNCH_SETTINGS.md](GITHUB_LAUNCH_SETTINGS.md) before public
launch or external proposal intake.

## Development

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements-dev.txt
python scripts/validate_v01.py
```

## License

This repository is licensed under the MIT License. See [LICENSE](LICENSE).
