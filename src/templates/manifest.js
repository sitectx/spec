import { commercialContextLink } from "../core/commercial-context.js";

export function createManifest(config, generatedAt) {
  const summary = config.positioning?.summary || config.description;
  const records = (config.sections || []).slice(0, 10).map((section) => ({
    id: `page:${section.id}`,
    type: "page",
    url: section.url,
    title: section.title,
    role: section.role,
    summary: section.summary
  }));
  const actions = (config.actions || []).slice(0, 20);
  const navigation = (config.navigation || []).slice(0, 20);
  const identity = config.identity || {};
  const commercialContext = commercialContextLink(config);

  return {
    specVersion: "0.1",
    kind: "sitectx.manifest",
    site: {
      name: config.name,
      url: config.siteUrl,
      description: config.description,
      language: config.language,
      ...(config.positioning?.vertical ? { vertical: config.positioning.vertical } : {}),
      ...(identity.logo ? { logo: identity.logo } : {}),
      ...(identity.profiles?.length ? { profiles: identity.profiles } : {})
    },
    summary,
    ...(Object.keys(identity).length > 0 ? { identity } : {}),
    freshness: {
      status: "fresh"
    },
    records,
    actions,
    ...(navigation.length > 0 ? { navigation } : {}),
    generatedAt,
    context: {
      url: "/sitectx.json",
      contentType: "application/json"
    },
    catalogs: {
      url: "/sitectx/catalogs.json",
      contentType: "application/json"
    },
    updates: {
      url: "/sitectx/updates.json",
      contentType: "application/json"
    },
    updatesNdjson: {
      url: "/sitectx/updates.ndjson",
      contentType: "application/x-ndjson"
    },
    ...(commercialContext ? { commercialContext } : {})
  };
}
