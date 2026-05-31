# GitHub launch settings

Before making the repository public or accepting external proposals, confirm:

## Teams

- [ ] `@sitectx/maintainers` exists.
- [ ] `@sitectx/maintainers` is visible.
- [ ] `@sitectx/maintainers` has Maintain or Admin access to `sitectx/spec`.
- [ ] `@sitectx/spec-maintainers` exists.
- [ ] `@sitectx/spec-maintainers` is visible.
- [ ] `@sitectx/spec-maintainers` has Write or Maintain access to `sitectx/spec`.
- [ ] CODEOWNERS resolves without GitHub warnings.

## Main branch protection / ruleset

- [ ] Require a pull request before merging.
- [ ] Require at least one approving review.
- [ ] Require review from Code Owners.
- [ ] Require the `human-owned-pr` status check to pass.
- [ ] Require conversation resolution before merging.
- [ ] Block force pushes.
- [ ] Block branch deletion.
- [ ] Restrict bypass permissions to the smallest possible maintainer set.

## v0.1 launch posture

- [ ] Decide whether PR creation should be restricted to collaborators during v0.1.
- [ ] Route outside proposals through Issues or Discussions if PRs are collaborators-only.
- [ ] Keep normative spec changes behind maintainer review.
- [ ] Do not merge generated bulk rewrites without human review and clear rationale.

These settings complement repository files. The repository files express the
policy; GitHub rulesets and branch protection enforce it.
