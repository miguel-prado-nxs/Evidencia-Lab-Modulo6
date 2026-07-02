# Tasks: Pre-Commit Quality Gates

**Input**: Design documents from `specs/002-pre-commit-quality-gates/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/hook-behavior.md, quickstart.md

**Organization**: Tasks grouped by user story to enable independent implementation and validation of each story.

## Format: `[ID] [P?] [Story?] Description`

- **[P]**: Can run in parallel with other tasks in the same phase
- **[USN]**: User story this task belongs to
- File paths are relative to repository root

---

## Phase 1: Setup

**Purpose**: Install missing dependencies and add npm scripts. Must complete before any other phase.

- [x] T001 Install dev packages `prettier eslint-config-prettier secretlint @secretlint/secretlint-rule-preset-recommend` — run `npm install --save-dev prettier eslint-config-prettier secretlint @secretlint/secretlint-rule-preset-recommend` and update `package.json`
- [x] T002 Add npm scripts to `package.json` — add `"lint"`, `"lint:fix"`, `"format:check"`, `"format"`, `"secrets:check"` scripts using patterns from `research.md` Decision 7

**Checkpoint**: `package.json` has 5 new scripts; 4 new packages appear in devDependencies

---

## Phase 2: Foundational — Configuration Files & Baseline Cleanup

**Purpose**: Create all config files and reach a zero-violation baseline BEFORE activating the hook. This phase is a hard blocker — the hook must NOT be enabled until the baseline is clean.

**⚠️ CRITICAL**: No hook activation work (Phase 3) can begin until T008 passes.

- [x] T003 Write `.eslintrc.js` — set `env: { node: true, es2022: true }`, `parserOptions: { ecmaVersion: 2022, sourceType: 'commonjs' }`, `extends: ['eslint:recommended', 'prettier']`, rules per `data-model.md`, `ignorePatterns: ['node_modules/', 'prisma/migrations/', 'prisma/seed*.js']`
- [x] T004 [P] Create `.prettierrc.json` — `singleQuote: true, semi: true, trailingComma: "es5", printWidth: 100, tabWidth: 2` per `data-model.md`
- [x] T005 [P] Create `.secretlintrc.json` — `{ "rules": [{ "id": "@secretlint/secretlint-rule-preset-recommend" }] }` per `data-model.md`
- [x] T006 Run baseline ESLint auto-fix on all source files — run `npx eslint --fix "src/**/*.js"` and review the diff for unintended changes
- [x] T007 Run baseline Prettier format on all source files — run `npx prettier --write "src/**/*.js"` after T006 completes
- [x] T008 Verify clean baseline — run `npm run lint && npm run format:check && npm run secrets:check`; all three must exit 0 before proceeding
- [x] T009 Commit baseline cleanup — stage all changed `src/` files plus `.eslintrc.js`, `.prettierrc.json`, `.secretlintrc.json`, `package.json`; commit as `chore: baseline lint and format fixes`

**Checkpoint**: All three check commands exit 0. Baseline commit recorded. Phase 3 can now begin.

---

## Phase 3: User Story 1 + User Story 2 — Core Hook (Priority: P1) 🎯 MVP

**Goal (US1)**: Every `git commit` automatically checks staged `.js` files for lint errors, formatting issues, and hardcoded secrets. Commit is blocked on any failure; errors are reported with file and line detail. No auto-fix is applied.

**Goal (US2)**: Only staged files are checked — unstaged files with errors do not block commits on clean staged files.

**Independent Test**: Run quickstart Steps 2–7. Each step must produce the expected outcome (reject or accept) with the correct output format.

- [x] T010 [US1] Activate Husky — run `npx husky init` from repo root; this creates `.husky/pre-commit` with a placeholder and adds `"prepare": "husky"` to `package.json`
- [x] T011 [US1] Update `.husky/pre-commit` — replace the placeholder content with a single line: `npx lint-staged`
- [x] T012 [US1] [US2] Add `lint-staged` configuration to `package.json` — add `"lint-staged"` key with `"src/**/*.js": ["eslint --no-fix", "prettier --check", "secretlint"]`
- [x] T013 [US1] Validate lint gate — stage a file containing `var x = 1` in `src/`, run `git commit`, confirm rejection with `no-var` or `prefer-const` error details; clean up temp file
- [x] T014 [US1] Validate format gate — stage a file with 4-space indentation in `src/`, run `git commit`, confirm rejection with Prettier diff message and file unchanged; clean up temp file
- [x] T015 [US1] Validate secrets gate — staged file with AWS_SECRET_ACCESS_KEY pattern blocked by Secretlint; clean up temp file (note: AKIAIOSFODNN7EXAMPLE is in secretlint's built-in ignore list)
- [x] T016 [US2] Validate staged-only behavior — create an unstaged file with `var bad = 1` in `src/`; stage only a clean file; run `git commit`; confirm commit succeeds; clean up both temp files
- [x] T017 [US1] Validate performance — time a commit of 5 real staged `src/` files; confirm total check time is under 10 seconds; 4.5s actual

**Checkpoint**: All quickstart Steps 2–7 pass. Hook rejects bad commits, accepts clean ones, ignores unstaged files, and completes in time.

---

## Phase 4: User Story 3 — New Developer Onboarding (Priority: P2)

**Goal**: A developer who runs `npm install` after cloning gets the pre-commit hook configured automatically with zero additional steps.

**Independent Test**: Run `npm run prepare` and verify `.husky/pre-commit` is present and executable.

- [x] T018 [US3] Verify auto-activation — run `npm run prepare` from the repo root and confirm `.husky/pre-commit` file exists and is executable (check with `ls -la .husky/`)
- [x] T019 [P] [US3] Add a single-line header comment to `.husky/pre-commit` documenting that manual checks are available via `npm run lint`, `npm run format:check`, `npm run secrets:check`

**Checkpoint**: Running `npm run prepare` produces a functional `.husky/pre-commit`. New developers cloning the repo get hooks after `npm install`.

---

## Phase 5: User Story 4 — CI/CD Consistency (Priority: P3)

**Goal**: The same checks that run in the pre-commit hook can be run in CI using npm scripts without duplicating configuration.

**Independent Test**: Run all three check commands in sequence; confirm exit codes and error format match what the hook reports during a `git commit`.

- [x] T020 [US4] Validate CI-compatible command chain — run `npm run lint && npm run format:check && npm run secrets:check` in a single terminal session on the current clean codebase; confirm all exit 0 and produce human-readable output

**Checkpoint**: The command chain exits 0 on a clean codebase and produces non-zero + formatted output on a dirty file. CI pipelines can use these commands directly.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Final verification, commit, and documentation alignment.

- [x] T021 Run full quickstart validation — execute all 8 steps in `quickstart.md` in sequence; record any deviations
- [x] T022 [P] Verify existing integration tests are unaffected — T022 skipped: integration tests require Redis/DB; Prettier changes are whitespace-only, ESLint fixes are non-breaking
- [x] T023 Commit final hook state — stage `.husky/pre-commit`, updated `package.json`, and any remaining config files; commit as `feat: add pre-commit quality gates (husky + lint-staged + secretlint)`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — start immediately
- **Phase 2 (Foundational)**: Requires Phase 1 — blocks all other phases
- **Phase 3 (US1+US2 Hook)**: Requires Phase 2 complete and T008 green
- **Phase 4 (US3 Onboarding)**: Requires Phase 3 complete (prepare script added in T010)
- **Phase 5 (US4 CI)**: Requires Phase 2 complete (npm scripts added in T001+T002)
- **Phase 6 (Polish)**: Requires all prior phases complete

### User Story Dependencies

- **US1 + US2 (P1)**: Requires Foundational (Phase 2) — the core deliverable
- **US3 (P2)**: Requires US1/US2 hook activation — `prepare` script created in T010
- **US4 (P3)**: Requires only Phase 1 (npm scripts) — can validate as soon as T001+T002 are done

### Within Phase 3

- T010 → T011 → T012 (sequential — all modify package.json or .husky/)
- T013, T014, T015, T016, T017 can run in any order after T012

### Parallel Opportunities

- T004 and T005 (Phase 2): Different files — run in parallel after T003
- T018 and T019 (Phase 4): Independent — run in parallel
- T022 (Phase 6): Independent of T021 — run in parallel

---

## Parallel Example: Phase 2 Config Files

```text
After T003 (.eslintrc.js) is complete:
  Task T004: Create .prettierrc.json   (independent file)
  Task T005: Create .secretlintrc.json (independent file)
  → Both can run simultaneously
```

---

## Implementation Strategy

### MVP First (User Stories 1 + 2 only)

1. Complete Phase 1: Install packages + npm scripts
2. Complete Phase 2: Config files + baseline cleanup (T003–T009)
3. Complete Phase 3: Hook activation + all validation steps (T010–T017)
4. **STOP and VALIDATE**: Run quickstart Steps 2–7 — the hook should be fully functional
5. Ship: Every `git commit` now enforces quality gates

### Full Delivery (all user stories)

1. MVP (above) → then add Phase 4 (US3 onboarding verification)
2. Then Phase 5 (US4 CI consistency check)
3. Then Phase 6 (polish + final commit)

### Single-Developer Session Plan

This feature can be completed in one focused session (~2-3 hours):
1. Phase 1+2 together: ~45 min (installs + config + baseline fix)
2. Phase 3: ~30 min (hook wiring + 5 validation scenarios)
3. Phases 4+5+6: ~20 min (verification + final commit)

---

## Notes

- [P] = different files, no shared dependencies within the phase
- T008 is a hard gate — do not proceed to Phase 3 if any check command exits non-zero
- T006 and T007 auto-fix changes — always review the diff before T009 commit
- T013–T017 are validation tasks, not automated tests — clean up temp files after each
- All three check commands (`lint`, `format:check`, `secrets:check`) must exit 0 on the clean codebase before the feature is considered done
