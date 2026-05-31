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
