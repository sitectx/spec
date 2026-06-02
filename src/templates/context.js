import { absoluteUrl } from "../core/urls.js";

export function createContext(config, generatedAt) {
  const records = config.sections.map((section) => ({
    id: `page:${section.id}`,
    type: "page",
    url: section.url,
    source_url: section.url,
    observed_at: generatedAt,
    title: section.title,
    summary: section.summary
  }));

  return {
    specVersion: "0.1",
    sitectx_version: "0.1",
    kind: "sitectx.context",
    site: {
      name: config.name,
      url: config.siteUrl,
      description: config.description,
      language: config.language
    },
    publisher: config.publisher,
    freshness: {
      status: "fresh",
      generated_at: generatedAt
    },
    generatedAt,
    resources: {
      manifest: absoluteUrl(config.siteUrl, "/.well-known/sitectx"),
      self: absoluteUrl(config.siteUrl, "/sitectx.json"),
      updates_json: absoluteUrl(config.siteUrl, "/updates.json"),
      updates: absoluteUrl(config.siteUrl, "/updates.ndjson")
    },
    feeds: [
      {
        type: "updates",
        format: "json",
        url: absoluteUrl(config.siteUrl, "/updates.json"),
        title: `${config.name} updates`,
        last_modified: generatedAt
      },
      {
        type: "updates",
        format: "ndjson",
        url: absoluteUrl(config.siteUrl, "/updates.ndjson"),
        title: `${config.name} update stream`,
        last_modified: generatedAt
      }
    ],
    sections: config.sections,
    records
  };
}
