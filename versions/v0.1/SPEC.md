# SiteCTX v0.1 Draft Specification

Status: Draft

## 1. Introduction

SiteCTX is a machine-readable context layer for websites. SiteCTX consists of a
required JSON manifest and optional linked update feeds and public evidence
resources. A SiteCTX manifest lets a site publish fresh, structured context for
automated systems, including important pages, entities, offers, updates,
freshness metadata, resource links, feed links, and supporting source URLs.

SiteCTX complements the website. Source pages remain the authoritative resources
for human readers, crawlers, search engines, accessibility tools, archives, and
other consumers.

SiteCTX is not crawler permission control, legal certification, a model training
permission format, a ranking guarantee, a replacement for the website itself, or
a complete semantic web ontology.

## 2. Conformance Language

The key words `MUST`, `MUST NOT`, `REQUIRED`, `SHALL`, `SHALL NOT`, `SHOULD`,
`SHOULD NOT`, `RECOMMENDED`, `NOT RECOMMENDED`, `MAY`, and `OPTIONAL` in this
document are to be interpreted as described in RFC 2119 when, and only when,
they appear in all capitals as shown here.

## 3. Terminology

Publisher:
: The website operator or system that publishes a SiteCTX manifest.

Consumer:
: An automated system that retrieves or processes a SiteCTX manifest.

Manifest:
: The top-level JSON document published by a site.

Resource:
: A linked SiteCTX document or feed, such as an update stream, update snapshot,
  evidence index, or evidence record.

Record:
: A JSON object in the manifest `records` array, or in a linked update feed,
  describing a page, entity, offer, or update.

Source URL:
: A URL for supporting source material. The source URL should identify the page
  or resource from which the record can be verified or understood.

Evidence resource:
: Public supporting source material linked from a manifest, update record, or
  evidence index.

Freshness:
: Metadata describing when the manifest was generated and whether the publisher
  believes the manifest is current.

## 4. Discovery

The preferred SiteCTX discovery endpoint is:

```text
/.well-known/sitectx
```

A publisher SHOULD make the current SiteCTX manifest available at this endpoint.

Optional aliases are:

```text
/.well-known/sitectx.json
```

The discovery endpoint SHOULD return the SiteCTX manifest JSON. Optional aliases
SHOULD return the same manifest as the preferred endpoint, or redirect to the
canonical manifest URL using normal HTTP redirects.

The conventional current context snapshot path is:

```text
/sitectx.json
```

`/sitectx.json` is not a manifest alias. It is a linked context snapshot that
the discovery manifest MAY point to.

The manifest is the SiteCTX entry point and index. It MAY link to additional
SiteCTX resources. Updates and evidence resources are optional linked resources;
they are not required for minimal conformance.

Optional conventional resource paths are:

```text
/sitectx/updates.ndjson
/sitectx/updates.json
/sitectx/evidence.json
/sitectx/evidence/{id}.json
```

`/sitectx/updates.ndjson` is the preferred append-style update stream.
`/sitectx/updates.json` is an optional JSON snapshot of recent update records.
`/sitectx/evidence.json` is an optional public evidence index.
`/sitectx/evidence/{id}.json` is an optional individual public evidence record.

Evidence resources are public supporting source material. They are not legal
certification, a truth guarantee, or private audit records.

The manifest SHOULD be served with `application/json` where practical. Consumers
MAY process a valid JSON response even when a different media type is returned.

Publishers SHOULD use HTTP caching headers that reflect the expected update
frequency of the manifest. Consumers SHOULD respect normal HTTP caching
semantics unless they have a site-specific reason to refresh sooner.

SiteCTX discovery does not grant permission to crawl, scrape, store, train on, or
rank content. Consumers MUST use existing permission, access-control, and policy
signals for those questions.

## 5. Manifest Format

A SiteCTX v0.1 manifest MUST be a JSON object.

The manifest MUST include these top-level fields:

- `sitectx_version`
- `site`
- `freshness`
- `records`

The `sitectx_version` field MUST be the string `"0.1"`.

Unknown top-level fields MUST be tolerated by consumers. Publishers SHOULD use
namespaced extension keys where practical, such as `x_example_field` or a
DNS-style namespace key such as `com.example.inventory`.

The manifest MAY link to additional resources by using the `resources` object,
the `feeds` array, record-level URLs, or extension fields.

### 5.1 Top-Level Fields

`sitectx_version`:
: REQUIRED string. For this specification it MUST be `"0.1"`.

`site`:
: REQUIRED object. Describes the website publishing the manifest. It SHOULD
  include `url` and MAY include `name`, `description`, `language`, `same_as`, or
  other descriptive fields.

`freshness`:
: REQUIRED object. Describes manifest freshness. See Section 6.

`records`:
: REQUIRED array. Contains zero or more record objects. See Section 7.

`resources`:
: OPTIONAL object. Links to related SiteCTX resources, such as the manifest
  itself, update feeds, update snapshots, and public evidence indexes. See
  Section 8.1.

`feeds`:
: OPTIONAL array. Links to related machine-readable feeds, including NDJSON
  update streams. See Section 8.2.

`source_urls`:
: OPTIONAL array of strings. Lists supporting site-wide source URLs, such as
  sitemap, feed, about, policy, or catalog pages.

`publisher`:
: OPTIONAL object. Identifies the publishing system or organization. This field
  is descriptive and is not a certification or trust claim.

`license`:
: OPTIONAL string or object. Describes terms that the publisher wants to
  associate with the SiteCTX manifest itself. It does not override the terms,
  permissions, or restrictions of linked website content.

## 6. Freshness

The `freshness` object MUST include:

- `status`
- `generated_at`

The `status` value MUST be one of:

- `fresh`
- `stale`
- `unknown`
- `error`

The `generated_at` value SHOULD be an RFC 3339-compatible date-time string.

Publishers MAY include `expires_at`, `next_update_at`, `checked_at`, or
`error_message`. Date-time values SHOULD use RFC 3339-compatible date-time
strings.

Freshness status meanings are:

`fresh`:
: The publisher believes the manifest reflects current site context.

`stale`:
: The publisher knows or suspects the manifest is older than intended, but it may
  still be useful.

`unknown`:
: The publisher cannot determine whether the manifest is current.

`error`:
: The publisher encountered an error generating or validating the manifest.
  Consumers MAY still inspect records but SHOULD treat freshness-sensitive values
  with caution.

## 7. Records

Each record MUST be a JSON object.

Each record MUST include:

- `id`
- `type`
- `observed_at`
- at least one of `url` or `source_url`

The `type` value MUST be one of:

- `page`
- `entity`
- `offer`
- `update`

The `observed_at` value SHOULD be an RFC 3339-compatible date-time string.

The `id` value SHOULD be stable within the publisher's SiteCTX output. Consumers
SHOULD NOT assume that identifiers are globally unique across sites unless they
are explicitly scoped by site URL or another namespace.

Records MAY include `source_urls` when multiple supporting URLs are useful.

Unknown record fields MUST be tolerated by consumers. Publishers SHOULD use
namespaced extension keys where practical for non-standard fields.

### 7.1 Common Record Fields

`id`:
: REQUIRED string. Stable publisher-defined identifier.

`type`:
: REQUIRED string. One of `page`, `entity`, `offer`, or `update`.

`observed_at`:
: REQUIRED string. Date and time when the publisher observed or generated the
  record state.

`url`:
: OPTIONAL string. Canonical URL for the thing described by the record.

`source_url`:
: OPTIONAL string. Supporting source URL. Required when `url` is absent.

`source_urls`:
: OPTIONAL array of strings. Additional supporting source URLs.

`title`:
: OPTIONAL string. Human-readable title.

`summary`:
: OPTIONAL string. Short human-readable summary.

`language`:
: OPTIONAL string. Language tag for the record content.

`tags`:
: OPTIONAL array of strings. Publisher-defined tags.

`updated_at`:
: OPTIONAL string. Date and time when the described resource was updated.

### 7.2 Page Records

A `page` record describes an important page on the site.

Page records SHOULD include `url`. They MAY include `title`, `summary`,
`page_role`, `language`, `updated_at`, `priority`, and `source_urls`.

The `page_role` field MAY be used for publisher-defined categories such as
`home`, `about`, `contact`, `pricing`, `support`, `product`, `article`,
`policy`, or `location`.

### 7.3 Entity Records

An `entity` record describes a notable organization, person, place, product,
service, event, or other named thing relevant to the site.

Entity records SHOULD include `name` and `entity_type`. They MAY include
`description`, `url`, `source_url`, `same_as`, `image`, and `attributes`.

SiteCTX v0.1 does not define a complete entity ontology. Publishers SHOULD use
plain, stable values that consumers can handle without site-specific code.

### 7.4 Offer Records

An `offer` record describes a current or recently observed offer, such as a
product, service, subscription, promotion, booking option, or other commercial
availability.

Offer records SHOULD include `name`. They MAY include `price`, `currency`,
`availability`, `valid_from`, `valid_until`, `terms_url`, `seller`, `item_id`,
and `source_urls`.

Offer data can become stale quickly. Publishers SHOULD set manifest and record
freshness conservatively for offers.

### 7.5 Update Records

An `update` record describes a change, announcement, article, event notice,
release note, alert, or other time-sensitive item.

Update records SHOULD include `title` and MAY include `published_at`,
`updated_at`, `category`, `severity`, `url`, `source_url`, `source_urls`, and
`evidence_url`.

Update records are also suitable for NDJSON update feeds.

## 8. Linked Resources

The manifest MAY link to additional SiteCTX resources. Linked resources are
optional. A publisher can conform to v0.1 by publishing only the required
manifest fields.

### 8.1 Resources Object

The optional top-level `resources` object provides well-known links to related
SiteCTX resources. Known fields are:

| Field | Description |
| --- | --- |
| `self` | URL of the manifest. |
| `updates` | Preferred NDJSON update feed URL. |
| `updates_json` | Optional JSON update snapshot URL. |
| `evidence` | Optional public evidence index URL. |

For example:

```json
{
  "resources": {
    "self": "https://example.com/.well-known/sitectx",
    "updates": "https://example.com/sitectx/updates.ndjson",
    "updates_json": "https://example.com/sitectx/updates.json",
    "evidence": "https://example.com/sitectx/evidence.json"
  }
}
```

Unknown `resources` fields MUST be tolerated by consumers. Publishers SHOULD use
absolute URLs for known `resources` fields when those resources are publicly
available.

### 8.2 Feeds

The optional top-level `feeds` array links to related streams. A feed object
SHOULD include:

- `type`
- `url`
- `format`

For v0.1, the feed `type` value `updates` identifies a stream of update records.

An updates feed MAY use newline-delimited JSON. For NDJSON feeds:

- `format` SHOULD be `ndjson`.
- Each non-empty line SHOULD be a JSON object.
- Each line SHOULD conform to the common record requirements for `type:
  "update"`.
- The feed SHOULD be served with `application/x-ndjson` where practical.

Feeds MAY include records that are not present in the manifest `records` array.
The manifest can therefore provide a compact current snapshot while a feed
provides a longer or more frequent update stream.

## 9. Date and Time Values

Timestamps SHOULD use RFC 3339-compatible date-time strings, such as:

```text
2026-05-31T14:00:00Z
```

Publishers SHOULD include time zone information. Consumers SHOULD tolerate valid
RFC 3339 offsets, such as `2026-05-31T10:00:00-04:00`.

## 10. URLs

URL fields SHOULD use absolute `https` URLs when the resource is publicly
available over HTTPS. Publishers MAY use other schemes where appropriate for
private, local, or specialized deployments.

Consumers MUST NOT assume that a URL appearing in SiteCTX is safe, authorized,
or endorsed beyond the publisher's descriptive claim.

## 11. Extensions

SiteCTX v0.1 is intentionally small. Publishers MAY add fields not defined by
this specification.

Consumers MUST ignore unknown fields that they do not understand. Consumers MUST
NOT reject an otherwise valid manifest solely because it contains unknown fields.

Publishers SHOULD namespace extension keys where practical. A namespace can be a
short `x_` prefix for local experiments or a DNS-style name for public
extensions.

Extensions MUST NOT change the meaning of required v0.1 fields.

## 12. JSON Schema

The non-exclusive JSON Schema for SiteCTX v0.1 is published at:

```text
versions/v0.1/schema/sitectx.schema.json
```

The schema is intended to catch common structural errors. The normative text in
this document defines the specification.

## 13. Security and Privacy

Publishers and consumers SHOULD review
[security-and-privacy.md](security-and-privacy.md). SiteCTX may expose fresh
site structure, business data, update timing, source URLs, and other operational
signals. Publishers should only publish information intended for automated
consumption.
