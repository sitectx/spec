import { describe, expect, it } from "vitest";
import { runCli } from "./helpers.js";

describe("CLI help and version", () => {
  it("sitectx --help exits 0 and shows commands", () => {
    const result = runCli(["--help"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("setup");
    expect(result.stdout).toContain("init");
    expect(result.stdout).toContain("discover");
    expect(result.stdout).toContain("generate");
    expect(result.stdout).toContain("validate");
    expect(result.stdout).toContain("doctor");
    expect(result.stdout).toContain("inspect");
    expect(result.stdout).toContain("npx sitectx@latest init");
    expect(result.stdout).toContain("npx sitectx@latest discover http://localhost:3000 --max-pages 25 --max-depth 2");
    expect(result.stdout).toContain("npx sitectx@latest generate sitectx.config.draft.json ./public --allow-draft --force");
  });

  it("subcommand help shows positional zero-install examples", () => {
    expect(runCli(["init", "--help"]).stdout).toContain("npx sitectx@latest init --root . --public-dir ./public");
    expect(runCli(["discover", "--help"]).stdout).toContain("Usage: sitectx discover [options] [url]");
    expect(runCli(["discover", "--help"]).stdout).toContain("npx sitectx@latest discover http://localhost:3000 --max-pages 25 --max-depth 2");
    expect(runCli(["generate", "--help"]).stdout).toContain("Usage: sitectx generate [options] [config] [out]");
    expect(runCli(["generate", "--help"]).stdout).toContain("npx sitectx@latest generate sitectx.config.draft.json ./public --allow-draft --force");
    expect(runCli(["validate", "--help"]).stdout).toContain("npx sitectx@latest validate ./public");
    expect(runCli(["doctor", "--help"]).stdout).toContain("npx sitectx@latest doctor http://localhost:3000");
    expect(runCli(["inspect", "--help"]).stdout).toContain("npx sitectx@latest inspect http://localhost:3000");
  });

  it("sitectx version prints the CLI version", () => {
    const result = runCli(["version"]);

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("SiteCTX CLI 0.1.0");
  });

  it("standard version flags print the raw package version", () => {
    for (const flag of ["--version", "-V"]) {
      const result = runCli([flag]);

      expect(result.status).toBe(0);
      expect(result.stdout.trim()).toBe("0.1.0");
    }
  });

  it("sitectx setup --help exits 0 and shows wizard help", () => {
    const result = runCli(["setup", "--help"], {
      env: { SITECTX_TEST_FAIL_ON_PROMPTS_LOAD: "1" }
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Usage: sitectx setup");
    expect(result.stdout).toContain("interactive SiteCTX setup wizard");
  });

  it("no args in a non-TTY prints help and exits 0", () => {
    const result = runCli([], {
      env: {
        CI: "0",
        SITECTX_TEST_FAIL_ON_PROMPTS_LOAD: "1"
      }
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Usage: sitectx");
    expect(result.stdout).toContain("setup");
  });

  it("no args in CI prints help and exits 0", () => {
    const result = runCli([], {
      env: {
        CI: "1",
        SITECTX_TEST_FAIL_ON_PROMPTS_LOAD: "1"
      }
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Usage: sitectx");
    expect(result.stdout).toContain("setup");
  });

  it("does not load prompts for non-interactive commands", () => {
    const guardedEnv = { SITECTX_TEST_FAIL_ON_PROMPTS_LOAD: "1" };

    expect(runCli(["--help"], { env: guardedEnv }).status).toBe(0);
    expect(runCli(["setup", "--help"], { env: guardedEnv }).status).toBe(0);
    expect(runCli(["init", "--help"], { env: guardedEnv }).status).toBe(0);
    expect(runCli(["init", "--dry-run"], { env: guardedEnv }).status).toBe(0);
    expect(
      runCli(
        [
          "init",
          "--site-url",
          "https://example.com",
          "--name",
          "Example Site",
          "--dry-run"
        ],
        { env: guardedEnv }
      ).status
    ).toBe(0);
  });
});
