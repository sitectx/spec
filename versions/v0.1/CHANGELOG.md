# Changelog

## v0.1 Draft - 2026-05-31

Initial draft specification.

- Defines discovery at `/.well-known/sitectx` with alternate endpoints
  `/.well-known/sitectx.json` and `/sitectx.json`.
- Defines required top-level fields: `sitectx_version`, `site`, `freshness`, and
  `records`.
- Defines freshness statuses: `fresh`, `stale`, `unknown`, and `error`.
- Defines v0.1 record types: `page`, `entity`, `offer`, and `update`.
- Defines common record requirements, including `id`, `type`, `observed_at`, and
  at least one of `url` or `source_url`.
- Adds optional feed links, including NDJSON update streams.
- Adds JSON Schema and examples for minimal, standard, update feed, and page
  record usage.
