# Governance

SiteCTX is maintained as a draft specification by repository maintainers. The
governance goal is to keep the format small, implementable, and useful across
publishers and automated consumers without favoring one implementation.

## Project Roles

- Contributors propose changes, file issues, and share implementation feedback.
- Editors maintain the specification text, examples, and schema consistency.
- Maintainers manage releases, repository policy, and consensus calls.

One person may hold more than one role.

## Decision Process

Changes should be discussed publicly where practical. Maintainers may merge
editorial fixes after review. Normative changes should remain open long enough
for implementers to evaluate compatibility and operational impact.

Maintainers should prefer rough consensus backed by concrete examples,
implementation experience, or clear interoperability analysis. If consensus is
unclear, maintainers may defer a change, mark it experimental, or reject it with
a written rationale.

## Pull Request Accountability

SiteCTX is maintained as a human-governed open specification. Maintainers may use
automation for validation, formatting, and administrative checks, but normative
spec changes require human review and maintainer approval. Contributions that
appear to be autonomous bot submissions, generated bulk rewrites, spam, or
unreviewed machine output may be closed without review.

## Versioning

The `versions/` directory contains published drafts. Changes within `v0.1`
should remain compatible with the v0.1 version identifier unless the repository
explicitly starts a new version directory.

The top-level `sitectx_version` value is part of the wire format. Consumers use
it to choose parsing and conformance behavior.

## Scope Control

SiteCTX should remain a context publication format. It is out of scope to turn
SiteCTX into crawler permission control, legal certification, model training
permission, a search ranking mechanism, a replacement for website content, or a
complete semantic web ontology.
