# Changelog

## v0.1 Draft - 2026-05-31

Initial draft specification.

- Defines discovery at `/.well-known/sitectx` with optional manifest alias
  `/.well-known/sitectx.json`.
- Defines `/sitectx.json` as the conventional current context snapshot path.
- Defines the discovery manifest with required top-level fields `specVersion`,
  `kind`, `site`, `generatedAt`, and `context`.
- Defines the context snapshot with required top-level fields `specVersion`,
  `sitectx_version`, `kind`, `site`, `freshness`, and `records`.
- Defines freshness statuses: `fresh`, `stale`, `unknown`, and `error`.
- Defines v0.1 record types: `page`, `entity`, `offer`, and `update`.
- Defines common record requirements, including `id`, `type`, `observed_at`, and
  at least one of `url` or `source_url`.
- Adds optional feed links, including NDJSON update streams.
- Adds JSON Schema and examples for minimal, standard, update feed, and page
  record usage.
