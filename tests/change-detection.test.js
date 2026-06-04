import { describe, expect, it } from "vitest";
import { summarizeConfigChanges } from "../src/core/change-detection.js";

describe("change detection", () => {
  it("summarizes page hash and action changes", () => {
    const previous = {
      sourcePages: [
        {
          id: "home",
          title: "Home",
          url: "https://example.com/",
          contentHash: "sha256:old"
        },
        {
          id: "pricing",
          title: "Pricing",
          url: "https://example.com/pricing",
          contentHash: "sha256:same"
        }
      ],
      actions: [
        {
          id: "action:contact",
          type: "contact",
          url: "https://example.com/contact",
          label: "Contact"
        }
      ]
    };
    const next = {
      sourcePages: [
        {
          id: "home",
          title: "Home",
          url: "https://example.com/",
          contentHash: "sha256:new"
        },
        {
          id: "about",
          title: "About",
          url: "https://example.com/about",
          contentHash: "sha256:about"
        }
      ],
      actions: [
        {
          id: "action:donate",
          type: "donate",
          url: "https://example.com/donate",
          label: "Donate"
        }
      ]
    };

    const changes = summarizeConfigChanges(previous, next);

    expect(changes.available).toBe(true);
    expect(changes.hasChanges).toBe(true);
    expect(changes.pages.changed).toEqual([
      {
        id: "home",
        title: "Home",
        url: "https://example.com/"
      }
    ]);
    expect(changes.pages.added.map((item) => item.id)).toEqual(["about"]);
    expect(changes.pages.removed.map((item) => item.id)).toEqual(["pricing"]);
    expect(changes.actions.added.map((item) => item.id)).toEqual(["action:donate"]);
    expect(changes.actions.removed.map((item) => item.id)).toEqual(["action:contact"]);
  });
});
