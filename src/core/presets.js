export const VERTICAL_PRESET_NAMES = [
  "auto",
  "ecommerce",
  "nonprofit",
  "saas",
  "local-business",
  "docs"
];

const PRESETS = {
  auto: {
    label: "Auto",
    description: "Use balanced discovery priorities.",
    roleBoosts: {},
    actionBoosts: {},
    catalogRoles: ["products", "pricing", "book"]
  },
  ecommerce: {
    label: "Ecommerce",
    description: "Prioritize products, pricing, buying actions, shipping, and catalog signals.",
    roleBoosts: {
      products: -80,
      buy: -80,
      pricing: -55,
      shipping: -35,
      contact: -10
    },
    actionBoosts: {
      buy: -70,
      search: -35,
      contact: -15,
      login: -10
    },
    catalogRoles: ["products", "pricing", "buy", "shipping"]
  },
  nonprofit: {
    label: "Nonprofit",
    description: "Prioritize donation, impact, contact, signup, and program pages.",
    roleBoosts: {
      donate: -130,
      about: -45,
      contact: -35,
      products: 35,
      pricing: 25
    },
    actionBoosts: {
      donate: -100,
      signup: -25,
      subscribe: -20,
      contact: -15,
      buy: 35
    },
    catalogRoles: []
  },
  saas: {
    label: "SaaS",
    description: "Prioritize pricing, demos, signup, docs, and support paths.",
    roleBoosts: {
      pricing: -90,
      docs: -55,
      contact: -25,
      products: -20,
      blog: 20
    },
    actionBoosts: {
      demo: -80,
      signup: -65,
      contact: -30,
      search: -20,
      buy: -10
    },
    catalogRoles: ["pricing", "products"]
  },
  "local-business": {
    label: "Local Business",
    description: "Prioritize booking, contact, service, location, and local intent.",
    roleBoosts: {
      book: -95,
      contact: -80,
      about: -35,
      products: -20,
      shipping: 15
    },
    actionBoosts: {
      book: -90,
      contact: -65,
      apply: -15,
      buy: -10
    },
    catalogRoles: ["book", "products"]
  },
  docs: {
    label: "Docs",
    description: "Prioritize documentation, guides, API references, search, and downloads.",
    roleBoosts: {
      docs: -130,
      products: 40,
      pricing: 25,
      buy: 35,
      blog: 15
    },
    actionBoosts: {
      search: -85,
      download: -55,
      learn: -35,
      contact: 10,
      buy: 45
    },
    catalogRoles: []
  }
};

export function normalizePreset(value) {
  const preset = String(value || "auto").trim().toLowerCase();
  if (VERTICAL_PRESET_NAMES.includes(preset)) {
    return preset;
  }
  throw new Error(`Unknown preset "${value}". Use one of: ${VERTICAL_PRESET_NAMES.join(", ")}.`);
}

export function presetProfile(value) {
  return PRESETS[normalizePreset(value)];
}

export function presetMetadata(value) {
  const preset = normalizePreset(value);
  const profile = PRESETS[preset];
  return {
    id: preset,
    label: profile.label,
    description: profile.description
  };
}

export function presetRoleBoost(value, role) {
  return presetProfile(value).roleBoosts[role] || 0;
}

export function presetActionBoost(value, actionType) {
  return presetProfile(value).actionBoosts[actionType] || 0;
}

export function presetCatalogRoles(value) {
  return presetProfile(value).catalogRoles;
}

export function applyPresetMetadata(config, presetValue) {
  const preset = normalizePreset(presetValue);
  if (preset === "auto") {
    return config;
  }
  const metadata = presetMetadata(preset);
  return {
    ...config,
    verticalPreset: preset,
    positioning: {
      ...(config.positioning || {}),
      vertical: metadata
    }
  };
}
