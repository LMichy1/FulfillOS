# Contributing to FulfillOS

## Workflow

1. Find or file a GitHub Issue describing the work. Issues are the source of truth for what needs doing.
2. Claim the issue (comment or assign yourself) before starting, to avoid overlapping work.
3. Branch from `main` using the naming convention:
   ```
   feat/issue-<number>-short-description
   fix/issue-<number>-short-description
   chore/issue-<number>-short-description
   ```
4. Commit using [Conventional Commits](https://www.conventionalcommits.org/):
   ```
   feat(inventory): implement atomic stock reservations
   fix(auth): enforce organization membership
   test(inventory): cover concurrent order creation
   docs(architecture): document tenancy boundaries
   ```
5. Before opening a PR: run `pnpm lint`, `pnpm typecheck`, and `pnpm test` locally, and review your own diff.
6. Open a PR using the pull request template, link the issue with `Closes #<number>`, and request review. Do not self-approve.
7. Do not merge until CI passes and the PR has the required review.

## Commit hygiene

- One coherent change per commit; don't bundle unrelated work.
- Never use `git add -A` / `git add .` blindly — review what's staged.
- Never commit `.env`, credentials, or generated build output.
- Never force-push to `main` or rewrite shared history.

## Code style

- TypeScript strict mode throughout.
- Formatting is enforced by Prettier (`pnpm format`) and checked in CI.
- Prefer explicit, simple implementations over generic abstractions. Don't add an abstraction (base repository, factory, etc.) unless there is a concrete second use case for it today.

## Testing expectations

- Domain rules, validation, and state transitions need unit tests.
- Anything touching transactions, concurrency, idempotency, or tenant isolation needs an integration test against a real PostgreSQL instance — do not mock the database for these.
- Critical user journeys need Playwright E2E coverage.
- Never weaken or delete a failing test just to get CI green; fix the underlying issue or flag it for discussion.
