# Data Model: Pre-Commit Quality Gates

This feature is developer tooling with no database entities. The "data" is configuration — version-controlled files that define the behavior of the hooks.

---

## Configuration Entities

### 1. Hook Configuration (`.husky/pre-commit`)

A shell script that runs on every `git commit` attempt.

| Attribute | Value | Notes |
|---|---|---|
| Trigger | `git commit` (pre-commit hook) | Executes before the commit is recorded |
| Runner | `npx lint-staged` | Delegates file-selection and command dispatch to lint-staged |
| Exit behavior | Non-zero exit = commit rejected | Standard POSIX exit code convention |
| CI behavior | Skipped when `CI=true` | Husky v9 built-in detection |

---

### 2. lint-staged Configuration (`package.json → "lint-staged"`)

Maps file glob patterns to the commands that run against each matched staged file.

| Attribute | Value | Notes |
|---|---|---|
| Scope | `"src/**/*.js"` | Only source files; excludes migrations, seeds, generated files |
| Commands (in order) | 1. `eslint --no-fix` | Lint check — report-only |
| | 2. `prettier --check` | Format check — report-only |
| | 3. `secretlint` | Secret detection |
| Execution model | Sequential per file group | If ESLint fails, Prettier still runs (all errors shown together) |
| Short-circuit | Yes — if any command exits non-zero, commit is blocked | lint-staged collects all errors then fails |

---

### 3. ESLint Configuration (`.eslintrc.js`)

Defines linting rules applied to all JavaScript files in `src/`.

| Attribute | Value |
|---|---|
| Environment | `node: true`, `es2022: true` |
| Parser | CommonJS (`sourceType: "commonjs"`) |
| Base ruleset | `eslint:recommended` |
| Formatting bridge | `prettier` (last in extends — disables conflicting rules) |
| Ignored paths | `node_modules/`, `prisma/migrations/`, `prisma/seed*.js` |

**Active rules** (non-recommended additions):

| Rule | Level | Rationale |
|---|---|---|
| `no-unused-vars` | warn | Allow `_`-prefixed intentional ignores |
| `no-var` | error | Enforce `const`/`let` |
| `prefer-const` | error | Enforce immutability where possible |
| `eqeqeq` | error | Enforce strict equality |
| `no-process-exit` | warn | Process.exit used in workers — warn not block |
| `no-console` | off | Project uses Winston but console.log exists |

---

### 4. Prettier Configuration (`.prettierrc.json`)

Defines formatting rules for all JavaScript files.

| Option | Value | Rationale |
|---|---|---|
| `singleQuote` | `true` | Matches existing code style in `src/` |
| `semi` | `true` | Project uses semicolons |
| `trailingComma` | `"es5"` | Trailing commas in arrays/objects where valid |
| `printWidth` | `100` | Wider than 80 for Express handler readability |
| `tabWidth` | `2` | Project standard |

---

### 5. Secretlint Configuration (`.secretlintrc.json`)

Defines secret/credential detection rules applied to staged files.

| Attribute | Value |
|---|---|
| Rule preset | `@secretlint/secretlint-rule-preset-recommend` |
| Detects | AWS credentials, JWT patterns, Slack/GitHub tokens, GCP keys, PEM private keys, generic API key patterns |
| False positive handling | Can add `allow` patterns per rule if needed for test fixtures |
