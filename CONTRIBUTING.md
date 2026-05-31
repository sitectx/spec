# Contributing

SiteCTX is an early draft specification. Contributions are welcome when they
improve clarity, interoperability, implementability, or safety.

## Human-Accountable Contributions

SiteCTX accepts contributions from identifiable human contributors who are
accountable for the proposed change.

Automated tools, AI coding assistants, formatters, linters, and generators may
be used, but a human contributor must:

- Understand the change.
- Be able to explain why it belongs in the SiteCTX specification.
- Confirm they reviewed the complete diff.
- Respond to maintainer questions.
- Accept responsibility for the contribution.

Pull requests opened by autonomous bots, unreviewed generated output, bulk
mechanical rewrites, SEO spam, or unexplained drive-by changes may be closed
without review.

AI-assisted contributions are allowed only when the submitting human reviewed,
tested where applicable, and stands behind the final content.

## Contribution Types

- Editorial fixes that clarify existing requirements.
- Examples that show realistic publisher and consumer behavior.
- Compatibility feedback from implementations.
- Schema fixes that align with the normative text.
- Security, privacy, and abuse-case analysis.

## Proposing Specification Changes

Open an Issue or Discussion before submitting a normative change, broad rewrite,
or change that affects compatibility. Small editorial fixes may be proposed
directly in a pull request when the scope is clear.

Normative changes should describe:

1. The interoperability problem.
2. The proposed requirement or allowance.
3. At least one publisher impact and one consumer impact.
4. Whether the change is backward compatible with v0.1 examples and schema.

Use RFC-style keywords carefully. In v0.1, `MUST`, `MUST NOT`, `SHOULD`,
`SHOULD NOT`, and `MAY` are interpreted as described by RFC 2119 when they
appear in uppercase.

## Compatibility Expectations

SiteCTX consumers are expected to tolerate unknown fields. Proposed extensions
should therefore prefer additive changes and namespaced extension keys where
practical.

Do not propose SiteCTX as a replacement for robots.txt, sitemaps, structured
data, feeds, access control, model training permissions, search ranking signals,
legal certification, or the website itself. SiteCTX should complement existing
web mechanisms.

## Pull Requests

Pull requests should keep normative text, JSON Schema, and examples aligned.
When changing JSON examples or schema files, verify that all `.json` files parse
successfully before requesting review.

Pull requests should explain the compatibility impact of the change. If the
change is not backward compatible with the current draft, describe the breaking
change clearly and explain why it is necessary.

Large rewrites should be discussed before pull request submission. Maintainers
may close pull requests that do not follow the contribution process, cannot be
explained by the submitter, or would make the specification harder to review or
maintain.
