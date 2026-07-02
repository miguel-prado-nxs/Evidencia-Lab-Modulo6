# Contract: Pre-Commit Hook Behavior

This contract defines the observable input/output behavior of the pre-commit hook system from a developer's perspective.

---

## Pre-Commit Hook Contract

### Trigger

Activated automatically by git when a developer runs `git commit` (or `git commit -m "..."`).
Not activated by: `git commit --no-verify`, `git merge --no-ff`, or `git rebase` (unless configured separately).

### Input

The set of files currently staged via `git add` at the moment `git commit` is invoked.
Only files matching `src/**/*.js` are passed to the checks. Other staged files (JSON, markdown, shell scripts, etc.) pass through unchecked.

### Processing (sequential per file)

1. **ESLint** (`eslint --no-fix`): Checks each staged `.js` file against `.eslintrc.js` rules.
2. **Prettier** (`prettier --check`): Checks each staged `.js` file against `.prettierrc.json` format rules.
3. **Secretlint** (`secretlint`): Scans each staged `.js` file for credential and secret patterns defined in `.secretlintrc.json`.

All three checks run regardless of whether a prior check found errors (full reporting mode).

### Output — Success

```
✔ Preparing lint-staged...
✔ Running tasks for staged files...
✔ Applying modifications from tasks...
✔ Cleaning up temporary files...
```

Exit code: `0` — git records the commit normally.

### Output — Failure

When any check fails, the commit is blocked:

```
✖ eslint --no-fix:
  src/services/myService.js
    5:3  error  'result' is assigned a value but never used  no-unused-vars
✖ prettier --check:
  src/controllers/myController.js
    Formatting differs. Run `npm run format` to fix.
✖ secretlint:
  src/config/env.js
    Possible API key detected at line 12
```

Exit code: non-zero — git aborts the commit. No files are modified. No partial commits occur.

### Developer Recovery Flow

1. Read the error output to identify the failing file(s) and rule(s).
2. Open and fix the file(s) manually.
3. Run `git add <file>` to re-stage the fixed files.
4. Run `git commit` again — checks re-run against the new staged content.

---

## Manual Check Command Contract

Developers can run the same checks outside of a commit:

| Command | What it checks | Report or Fix |
|---|---|---|
| `npm run lint` | ESLint rules on all `src/**/*.js` | Report only |
| `npm run format:check` | Prettier format on all `src/**/*.js` | Report only |
| `npm run secrets:check` | Secretlint on all `src/**/*.js` | Report only |
| `npm run lint:fix` | ESLint auto-fixable rules | Auto-fix (safe) |
| `npm run format` | Prettier formatting | Auto-fix (formatting) |

`lint:fix` and `format` are provided for the baseline cleanup step and developer convenience. They are not called by the hook.

---

## CI/CD Behavior Contract

When running in a CI environment (`CI=true` environment variable is set):
- Husky's `prepare` script skips hook installation automatically.
- The CI pipeline should call `npm run lint && npm run format:check && npm run secrets:check` directly.
- Same rules, same commands — no configuration divergence (SC-004).

---

## Bypass Contract

A developer may bypass the hook with `git commit --no-verify`. This is a git feature and cannot be prevented at the tooling level. The team convention is that `--no-verify` is reserved for emergency hotfixes only and the developer takes responsibility for the commit quality.
