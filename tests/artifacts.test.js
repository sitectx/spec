import { describe, expect, it } from "vitest";
import { toWritePlan } from "../src/core/artifacts.js";

describe("artifact write planning", () => {
  it("rejects artifact paths that are absolute or traverse directories", () => {
    for (const relativePath of [
      "../escaped.json",
      "sitectx/../escaped.json",
      "/tmp/escaped.json",
      "\\escaped.json"
    ]) {
      expect(() => toWritePlan("/tmp/sitectx-public", [{ relativePath, content: "{}\n" }])).toThrow();
    }
  });
});
