import { absoluteUrl } from "../core/urls.js";

export function createContext(config, generatedAt) {
  const records = config.sections.map((section) => ({
    id: `page:${section.id}`,
    type: "page",
    url: section.url,
    source_url: section.url,
    observed_at: generatedAt,
    title: section.title,
    page_role: section.role,
    summary: section.summary
  }));
  const identity = config.identity || {};

  const context = {
    specVersion: "0.1",
    sitectx_version: "0.1",
    kind: "sitectx.context",
    site: {
      name: config.name,
      url: config.siteUrl,
      description: config.description,
      language: config.language,
      ...(config.positioning?.vertical ? { vertical: config.positioning.vertical } : {}),
      ...(identity.logo ? { logo: identity.logo } : {}),
      ...(identity.profiles?.length ? { profiles: identity.profiles } : {})
    },
    publisher: config.publisher,
    ...(Object.keys(identity).length > 0 ? { identity } : {}),
    freshness: {
      status: "fresh",
      generated_at: generatedAt
    },
    generatedAt,
    resources: {
      manifest: absoluteUrl(config.siteUrl, "/.well-known/sitectx"),
      self: absoluteUrl(config.siteUrl, "/sitectx.json"),
      catalogs: absoluteUrl(config.siteUrl, "/sitectx/catalogs.json"),
      updates_json: absoluteUrl(config.siteUrl, "/sitectx/updates.json"),
      updates: absoluteUrl(config.siteUrl, "/sitectx/updates.ndjson")
    },
    feeds: [
      {
        type: "updates",
        format: "json",
        url: absoluteUrl(config.siteUrl, "/sitectx/updates.json"),
        title: `${config.name} updates`,
        last_modified: generatedAt
      },
      {
        type: "updates",
        format: "ndjson",
        url: absoluteUrl(config.siteUrl, "/sitectx/updates.ndjson"),
        title: `${config.name} update stream`,
        last_modified: generatedAt
      }
    ],
    sections: config.sections,
    records
  };

  if (config.positioning) {
    context.positioning = config.positioning;
  }
  if (config.canonicalFacts?.length) {
    context.canonicalFacts = config.canonicalFacts;
  }
  if (config.products?.length) {
    context.products = config.products;
  }
  if (config.claims?.length) {
    context.claims = config.claims;
  }
  if (config.faq?.length) {
    context.faq = config.faq;
  }
  if (config.actions?.length) {
    context.actions = config.actions;
  }
  if (config.navigation?.length) {
    context.navigation = config.navigation;
  }
  if (config.catalogs?.length) {
    context.catalogs = config.catalogs;
  }
  if (config.sourcePages?.length) {
    context.sourcePages = config.sourcePages;
  }

  return context;
}
