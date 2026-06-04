import { normalizeSiteUrl } from "../core/urls.js";
import { applyPresetMetadata } from "../core/presets.js";

export function createDefaultConfig(options = {}) {
  const siteUrl = normalizeSiteUrl(options.siteUrl || "https://example.com");
  const name = options.name || "Example Site";
  const description = options.description || `Machine-readable website context for ${name}.`;
  const rootUrl = `${siteUrl}/`;
  const sampleContent = options.sampleContent !== false;

  return applyPresetMetadata({
    siteUrl,
    name,
    description,
    language: "en",
    publisher: {
      name,
      url: siteUrl
    },
    identity: {
      name,
      url: siteUrl,
      description,
      sourceUrl: rootUrl
    },
    positioning: {
      summary: description,
      audience: [],
      not: [
        "Not a crawler permission system",
        "Not a model training license",
        "Not a ranking guarantee"
      ]
    },
    actions: [
      {
        id: "action:home",
        type: "learn",
        url: rootUrl,
        label: "Visit site",
        priority: 1,
        sourceUrl: rootUrl,
        sourceText: "Visit site"
      }
    ],
    sections: sampleContent
      ? [
          {
            id: "home",
            title: "Home",
            url: rootUrl,
            role: "home",
            summary: description
          },
          {
            id: "about",
            title: "About",
            url: `${siteUrl}/about`,
            role: "about",
            summary: "Information about the organization, product, or website."
          }
        ]
      : [
          {
            id: "home",
            title: "Home",
            url: rootUrl,
            role: "home",
            summary: description
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
  }, options.preset);
}
