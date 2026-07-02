# Research: Pre-Commit Quality Gates

**Date**: 2026-06-18
**Feature**: Pre-commit hooks for easyorder-partners-api

---

## Decision 1: Hook Manager — Husky v9

**Decision**: Use Husky v9 (already installed as `^9.1.7` in devDependencies).

**Rationale**: Already in the project. Husky v9 is the de-facto standard for Node.js repos. Auto-skips when `CI=true` environment variable is present, so it does not interfere with CI pipelines. Setup is a single `prepare` script addition — no Python, no external binary.

**Alternatives considered**:
- `pre-commit` (YAML/Python): Requires Python runtime. Adds a non-npm dependency to a pure Node.js project. Rejected.
- `simple-git-hooks`: Lighter than Husky but lacks the ecosystem and auto-CI-skip behavior. Rejected.
- Manual `.git/hooks/pre-commit` shell script: Not version-controllable. Rejected.

**Husky v9 activation**: Add `"prepare": "husky"` to package.json `scripts`. This runs automatically after `npm install`. The `postinstall` script (Prisma generate) already exists and does not conflict — `prepare` and `postinstall` are separate lifecycle hooks.

---

## Decision 2: Staged-Files Runner — lint-staged v17

**Decision**: Use lint-staged v17 (already installed as `^17.0.7` in devDependencies).

**Rationale**: Already in the project. lint-staged passes only staged `.js` files to each command, satisfying FR-003 (check only staged files). It also handles the stash/unstash of unstaged changes transparently, so only the exact staged content is checked.

**Configuration location**: `"lint-staged"` key in `package.json` (or `lint-staged.config.js`). Inline in package.json is preferred for discoverability.

**Exclusion handling**: Files matching `prisma/migrations/**` and `prisma/seed*.js` are excluded by scoping the lint-staged glob to `"src/**/*.js"` only. This is simpler and more explicit than negation patterns.

---

## Decision 3: Linting — ESLint 10

**Decision**: ESLint v10 (already installed as `^10.5.0` in devDependencies) with `eslint:recommended` base + `prettier` config last to disable formatting-related rules.

**Rationale**: Already in the project. ESLint 10 supports flat config (`eslint.config.js`) but also legacy `.eslintrc.js`. The project currently uses `.eslintrc.js` (legacy format), which is still fully supported in ESLint 10. Using legacy format avoids a migration scope increase.

**Key rules for this project**:
- `no-unused-vars` — warn (with `argsIgnorePattern: "^_"` for intentional ignored args)
- `no-var` — error (enforce `const`/`let`)
- `prefer-const` — error
- `eqeqeq` — error (enforce `===`)
- `no-process-exit` — warn (process.exit is used in workers, keep as warn)
- `no-console` — off (project uses Winston logger but direct console.log exists in some places)

**Extends**: `['eslint:recommended', 'prettier']` — `prettier` must be last to turn off conflicting formatting rules.

**Additional package needed**: `eslint-config-prettier` — disables ESLint rules that would conflict with Prettier formatting decisions.

---

## Decision 4: Formatting — Prettier 3

**Decision**: Install `prettier@^3` as a dev dependency. Run as `prettier --check` (report-only, no auto-write) in lint-staged.

**Rationale**: Prettier is the standard formatter for Node.js projects. Running `--check` (not `--write`) satisfies FR-010 (report-only, no auto-correction). Developers see the diff of what Prettier would change and apply it manually or via `npm run format`.

**Config file**: `.prettierrc.json` at repo root. Key settings for this Node.js project:
- `singleQuote: true` — consistent with the existing code style in `src/`
- `semi: true` — project uses semicolons
- `trailingComma: "es5"` — trailing commas where valid in ES5
- `printWidth: 100` — slightly wider than default 80 for Express route handlers
- `tabWidth: 2`

**Alternatives considered**:
- `eslint --fix` for formatting: Mixing linting and formatting in one tool causes conflicts. Rejected.
- No formatter (lint only): Formatting drift still allowed. Rejected per spec requirements.

---

## Decision 5: Secret Detection — Secretlint

**Decision**: Install `secretlint` + `@secretlint/secretlint-rule-preset-recommend` as dev dependencies. Run as `secretlint --secretlintrc .secretlintrc.json` in lint-staged.

**Rationale**: Pure Node.js, npm-installable, no Python or Go binary required. Detects common credential patterns: AWS keys, JWT secrets (patterns), Slack tokens, GitHub tokens, GCP service account keys, private keys in PEM format, and generic API key patterns. This directly addresses SC-006 and FR-008.

**Alternatives considered**:
- `gitleaks`: Go binary, requires non-npm install. Rejected (breaks FR-004 zero-extra-steps).
- `detect-secrets` (Yelp): Python-based. Rejected (requires Python runtime).
- `git-secrets` (AWS): Shell script. Not cross-platform. Rejected.
- Manual regex in ESLint: High maintenance, easy to miss patterns. Rejected.

**Config file**: `.secretlintrc.json` with `@secretlint/secretlint-rule-preset-recommend`. The preset covers the most critical credential types for this project (ElevenLabs keys match `apikey` pattern, JWT secrets match generic patterns, AWS S3 credentials match AWS-specific rules).

---

## Decision 6: Baseline Cleanup Strategy

**Decision**: Run a one-time automated fix pass before enabling the hook, committed as a single "chore" commit.

**Approach**:
1. Run `npx eslint --fix "src/**/*.js"` — auto-fixes safe lint issues (semicolons, quotes, unused imports where safe)
2. Run `npx prettier --write "src/**/*.js"` — formats all source files
3. Commit as `chore: baseline lint and format fixes`
4. Then activate the hook — all subsequent commits start from a clean baseline

**Rationale**: Matches the clarified decision from `/speckit-clarify`. This is the cleanest adoption strategy — no "warning period", no ignoring files. Developers start with the hook enabled against a clean codebase.

**Risk**: Auto-fix may introduce subtle changes in whitespace-sensitive string literals. Mitigation: review the diff before committing, run tests after the baseline commit.

---

## Decision 7: Manual Check Command

**Decision**: Add `"lint"` and `"format:check"` and `"secrets:check"` npm scripts to package.json.

**Rationale**: FR-005 requires a documented manual check command. Adding named npm scripts makes the checks runnable in CI and by developers without memorizing tool flags.

```json
"lint": "eslint \"src/**/*.js\"",
"format:check": "prettier --check \"src/**/*.js\"",
"secrets:check": "secretlint \"src/**/*.js\"",
"lint:fix": "eslint --fix \"src/**/*.js\"",
"format": "prettier --write \"src/**/*.js\""
```

Note: `lint:fix` and `format` are convenience scripts for the baseline cleanup step only. They are explicitly NOT called by the hook (report-only per FR-010).

---

## Packages to Install

```
npm install --save-dev prettier eslint-config-prettier secretlint @secretlint/secretlint-rule-preset-recommend
```

Already installed (no action needed):
- `eslint@^10.5.0`
- `husky@^9.1.7`
- `lint-staged@^17.0.7`
