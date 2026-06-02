import { normalizeSiteUrl } from "../core/urls.js";

export function createDefaultConfig(options = {}) {
  const siteUrl = normalizeSiteUrl(options.siteUrl || "https://example.com");
  const name = options.name || "Example Site";
  const rootUrl = `${siteUrl}/`;

  return {
    siteUrl,
    name,
    description: `Official SiteCTX context for ${name}.`,
    language: "en",
    publisher: {
      name,
      url: siteUrl
    },
    sections: [
      {
        id: "home",
        title: "Home",
        url: rootUrl,
        summary: "Primary website homepage."
      },
      {
        id: "about",
        title: "About",
        url: `${siteUrl}/about`,
        summary: "Information about the organization, product, or website."
      }
    ],
    updates: [
      {
        id: "initial-context",
        type: "created",
        url: rootUrl,
        title: "Initial SiteCTX context published",
        summary: "Initial machine-readable site context was published."
      }
    ]
  };
}
