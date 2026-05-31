# SiteCTX v0.1 Security and Privacy Considerations

SiteCTX publishes structured context that automated systems can process quickly.
SiteCTX manifests are public unless a publisher places them behind separate
access control. That convenience creates operational, security, and privacy
risks. Publishers and consumers should treat a SiteCTX manifest as untrusted
site-provided input unless they have an independent trust relationship.

## Publisher Considerations

Publish only public information intended for automated consumption. A manifest
can reveal important pages, source URLs, update timing, product availability,
business priorities, internal naming patterns, or stale content that would be
harder to infer from ordinary browsing.

Publishers SHOULD avoid including personal data unless there is a clear public
purpose and the data is already appropriate for publication on the site.

Publishers SHOULD avoid leaking:

- secrets;
- private or unlisted URLs;
- internal URLs;
- session identifiers;
- API keys;
- private customer data;
- customer-specific private pricing;
- non-public documents;
- draft, embargoed, or access-controlled content;
- internal identifiers that expose business systems;
- sensitive inventory, pricing, or availability details;
- personal contact information that is not already public and intentional;
- operational error messages that reveal infrastructure details.

Freshness metadata can disclose publishing workflows. If exact generation times
are sensitive, publishers MAY round timestamps while still using RFC
3339-compatible date-time strings.

SiteCTX is not a permission or certification format. Publishers SHOULD continue
to use existing access-control, robots.txt, licensing, contractual, and policy
mechanisms for those purposes.

## Consumer Considerations

Consumers MUST treat SiteCTX content as untrusted input. A manifest can contain
malicious URLs, misleading summaries, spam, prompt-injection text, oversized
payloads, or fields designed to exploit downstream parsers.

Consumers SHOULD apply normal defensive controls:

- bound response sizes and feed lengths;
- use timeouts and retry limits;
- avoid fetching private network addresses unless explicitly allowed;
- validate URL schemes and hosts before follow-up fetches;
- sanitize text before rendering it in an interface;
- avoid executing scripts or markup from manifest fields;
- keep parser dependencies current;
- separate SiteCTX claims from independently verified facts.

Consumers that fetch linked `source_url`, `source_urls`, or feed URLs SHOULD
protect against server-side request forgery, redirect abuse, decompression bombs,
and unexpectedly large resources.

## Feeds

NDJSON update feeds can grow without bound. Consumers SHOULD process feeds
incrementally, enforce line and file size limits, and handle malformed lines
without losing control of the ingestion process.

Publishers SHOULD document expected retention windows or use HTTP caching and
conditional requests where practical.

## Integrity

SiteCTX v0.1 does not define signing, authentication, legal attestation, trust
chains, or certification. HTTPS helps protect transport integrity, but it does
not prove that records are true, complete, unbiased, or legally authorized.

Consumers that require stronger integrity assurances SHOULD use an external trust,
signing, or contractual mechanism outside SiteCTX v0.1.
