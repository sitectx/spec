import { absoluteUrl } from "../core/urls.js";

export function createCatalogs(config, generatedAt) {
  const catalogs = (config.catalogs || []).map((catalog) => ({
    ...catalog,
    observedAt: catalog.observedAt || generatedAt
  }));

  return {
    specVersion: "0.1",
    kind: "sitectx.catalogs",
    site: {
      name: config.name,
      url: config.siteUrl
    },
    generatedAt,
    resources: {
      manifest: absoluteUrl(config.siteUrl, "/.well-known/sitectx"),
      context: absoluteUrl(config.siteUrl, "/sitectx.json"),
      self: absoluteUrl(config.siteUrl, "/sitectx/catalogs.json")
    },
    catalogs
  };
}
