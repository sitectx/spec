# SiteCTX v0.1

SiteCTX v0.1 is a draft JSON manifest format for publishing fresh, structured
site context to automated systems. The required core is the manifest; publishers
may also link to optional catalog indexes, update feeds, public evidence
resources, and disclosed sponsored context.
The manifest should include enough compact context to be useful on first fetch,
including site description, summary, freshness, important records, and user
actions such as donate, contact, book, buy, sign up, and subscribe.
Actions may include priority, source URL, and source text so consumers can
understand the publisher-visible path for each intent.

The preferred discovery endpoint is:

```text
/.well-known/sitectx
```

Optional aliases are:

```text
/.well-known/sitectx.json
```

The manifest should be served as JSON and should return `application/json` where
practical.

The conventional current context snapshot path is:

```text
/sitectx.json
```

`/sitectx.json` is not a manifest alias.

Optional conventional linked resources include:

```text
/sitectx/updates.ndjson
/sitectx/updates.json
/sitectx/catalogs.json
/sitectx/sponsored-context.json
/sitectx/evidence.json
/sitectx/evidence/{id}.json
```

## Draft Documents

- [SPEC.md](SPEC.md): normative v0.1 draft
- [conformance.md](conformance.md): conformance classes and validation guidance
- [security-and-privacy.md](security-and-privacy.md): security and privacy
  considerations
- [schema/sitectx.schema.json](schema/sitectx.schema.json): JSON Schema
- [schema/sponsored-context.schema.json](schema/sponsored-context.schema.json):
  sponsored context JSON Schema

## Examples

- [examples/minimal.sitectx.json](examples/minimal.sitectx.json): smallest useful
  manifest
- [examples/standard.sitectx.json](examples/standard.sitectx.json): broader
  manifest with pages, entities, offers, updates, resources, and feeds
- [examples/catalogs.json](examples/catalogs.json): catalog pointer index for
  dynamic inventory or listing sources
- [examples/sponsored-context.json](examples/sponsored-context.json): disclosed
  sponsored commercial placement resource
- [examples/updates.ndjson](examples/updates.ndjson): line-delimited update feed
- [examples/updates.json](examples/updates.json): JSON update snapshot
- [examples/evidence.json](examples/evidence.json): public evidence index
- [examples/evidence-record.json](examples/evidence-record.json): individual
  public evidence record
- [examples/page-record.json](examples/page-record.json): standalone page record

## Compatibility Notes

SiteCTX v0.1 consumers should tolerate unknown fields as extensions. Publishers
should namespace extension keys where practical.

SiteCTX does not define crawl permissions, legal certifications, model training
permissions, ranking guarantees, or a complete ontology.
