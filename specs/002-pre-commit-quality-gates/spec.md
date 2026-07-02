# Feature Specification: Pre-Commit Quality Gates

**Feature Branch**: `002-pre-commit-quality-gates`

**Created**: 2026-06-18

**Status**: Draft

**Input**: User description: "Me gustaria implementar la funcionalidad de pre-commit en partners api ya que quiero que se revise de mjeor manera el codigo antes de que se pushee a github, el detalle es que no se cual es el mejor para el repo ya que en otros use un yaml y tambien lei que existe la opcion de implementarlo con husky, podrias revisar y decirme cual es lo mejor para esto"

## Clarifications

### Session 2026-06-18

- Q: Does the hook auto-fix formatting issues, or only report them? → A: Report-only; the developer must fix all issues manually and recommit.
- Q: How should pre-existing lint violations be handled when a developer stages a file that already has errors? → A: All existing violations will be corrected as a prerequisite before the hook is activated, ensuring a clean codebase baseline from day 1.
- Q: What checks should be included beyond linting and formatting? → A: Lint + format + detection of hardcoded secrets/credentials in staged files.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Blocked Commit on Code Issues (Priority: P1)

A developer makes a change to the codebase and tries to commit. Before the commit is recorded, the system automatically checks the staged files. If linting errors, formatting issues, or detected secrets exist, the commit is rejected with a clear message listing what is wrong. The system never auto-corrects these issues — the developer must fix them manually and re-commit.

**Why this priority**: This is the core value of the feature — preventing broken or inconsistent code from entering the repository history. Every other story depends on this mechanism working.

**Independent Test**: Can be fully tested by staging a file with a known lint error and running `git commit`. The commit should fail with a diagnostic message identifying the error.

**Acceptance Scenarios**:

1. **Given** a staged file with a linting error, **When** the developer runs `git commit`, **Then** the commit is rejected and the specific error and file are reported; no automatic fix is applied.
2. **Given** a staged file with a formatting inconsistency, **When** the developer runs `git commit`, **Then** the commit is rejected with the formatting issue described; the file remains unchanged.
3. **Given** a staged file containing a hardcoded secret or credential pattern, **When** the developer runs `git commit`, **Then** the commit is rejected with a message identifying the pattern and file location.
4. **Given** staged files with no errors, **When** the developer runs `git commit`, **Then** the commit proceeds normally with no interruption.
5. **Given** a developer who fixes all reported issues, **When** they stage the fixed files and run `git commit` again, **Then** the commit succeeds.

---

### User Story 2 - Only Staged Files Are Checked (Priority: P1)

The checks run only on the files the developer is committing, not on the entire codebase. This keeps the process fast and avoids blocking a commit because of pre-existing issues in unrelated files.

**Why this priority**: Equal priority to Story 1 — without this, commits become prohibitively slow and developers are blocked by issues they did not introduce, leading to bypass attempts.

**Independent Test**: Can be tested by introducing a known error in a file that is NOT staged. Running `git commit` on other clean staged files should succeed without reporting the unstaged error.

**Acceptance Scenarios**:

1. **Given** an unstaged file with errors and staged files without errors, **When** the developer runs `git commit`, **Then** only the staged files are checked and the commit succeeds.
2. **Given** a large codebase with many files, **When** a developer stages two files, **Then** only those two files are analyzed during the commit check.

---

### User Story 3 - New Developer Onboarding (Priority: P2)

A new developer clones the repository, installs dependencies, and the pre-commit checks are automatically configured on their machine without manual steps.

**Why this priority**: Important for team consistency. If setup requires manual steps, some developers will skip it, defeating the purpose.

**Independent Test**: Can be tested by cloning the repository, running `npm install`, and then attempting a commit. The checks should run without any additional configuration.

**Acceptance Scenarios**:

1. **Given** a fresh clone of the repository, **When** a developer runs the standard dependency installation command, **Then** the pre-commit checks are configured automatically.
2. **Given** a developer who has not done any extra configuration, **When** they run `git commit`, **Then** the checks execute correctly.

---

### User Story 4 - CI/CD Consistency (Priority: P3)

The same checks that run locally before a commit can also be run in CI/CD without duplicating configuration. The checks defined once serve as the source of truth for both local development and the pipeline.

**Why this priority**: Reduces maintenance burden and avoids divergence between what developers see locally and what the pipeline enforces.

**Independent Test**: Can be tested by running the lint/format check commands used in the pre-commit hooks directly as a standalone command (e.g., in CI), producing the same results.

**Acceptance Scenarios**:

1. **Given** the pre-commit configuration, **When** the equivalent check command is run in CI, **Then** results match what developers see locally.

---

### Edge Cases

- What happens when a developer forcefully bypasses the commit hook (e.g., `--no-verify` flag)?
- How does the system handle generated files or vendor files that should not be linted?
- What happens if the tool used for checks is not installed on the developer's machine after cloning?
- How does the system behave if the pre-commit check takes more than 30 seconds?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST block a `git commit` when any staged file contains a linting error.
- **FR-002**: The system MUST report the exact file path, line number, and error description when rejecting a commit.
- **FR-003**: The system MUST check only files that are part of the current commit (staged files), not the entire codebase.
- **FR-004**: The pre-commit checks MUST be activated automatically after running the standard project dependency installation command (`npm install`).
- **FR-005**: Developers MUST be able to run the same quality checks manually (outside of a commit) via a documented command.
- **FR-006**: The configuration MUST allow specifying which file types or directories are excluded from checks (e.g., generated files, migrations, seeds).
- **FR-007**: The system MUST complete checks on a typical commit (1-5 modified files) in under 10 seconds.
- **FR-008**: The commit hook checks MUST include: JavaScript linting, code formatting consistency, and detection of hardcoded secrets or credentials in staged files.
- **FR-009**: The configuration MUST be version-controlled alongside the codebase so all team members use the same rules.
- **FR-010**: The hook MUST report issues to the developer without applying any automatic corrections; developers are solely responsible for fixing and re-staging files.
- **FR-011**: Before the hook is activated in the repository, all pre-existing lint and formatting violations in the codebase MUST be corrected to establish a clean baseline. The hook must not be enabled on a codebase with known outstanding violations.

### Key Entities

- **Pre-commit hook**: An automated check that runs when a developer attempts to create a git commit. Determines whether the commit is accepted or rejected.
- **Staged file**: A file that has been explicitly marked for inclusion in the next commit via `git add`.
- **Lint rule**: A defined code style or correctness constraint that all files must satisfy before being committed.
- **Exclusion rule**: A pattern defining files or directories that are exempt from checks (e.g., auto-generated migration files).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of commits to the repository pass the defined quality checks before being recorded (no bypasses by default workflow).
- **SC-002**: The pre-commit check completes in under 10 seconds for a typical commit of 1-5 modified files.
- **SC-003**: A new developer can set up the pre-commit hooks with zero manual steps beyond the standard `npm install`.
- **SC-004**: Zero configuration drift between developer machines — all team members run identical checks.
- **SC-005**: The number of linting-related review comments on pull requests decreases by at least 80% within one sprint of adoption.
- **SC-006**: Zero commits containing hardcoded secrets or credentials patterns reach the repository history after the hook is activated.

## Assumptions

- The team uses Node.js and npm as the primary toolchain; no Python or external runtime beyond Node.js is required.
- Developers are familiar with standard git workflows; they are aware the `--no-verify` bypass exists but understand it should not be used in normal development.
- An `.eslintrc.js` configuration file already exists or will be created as part of this feature to define the linting rules.
- A one-time baseline cleanup pass (fixing all existing violations) is an explicit prerequisite and is considered part of this feature's scope, not a separate task.
- The CI/CD pipeline already runs lint checks; this feature addresses the local developer workflow gap, not CI replacement.
- Migration files under `prisma/migrations/` and seed files are explicitly excluded from formatting checks to avoid false positives on auto-generated SQL/JS.
- Mobile support and browser support are out of scope — this is a developer tooling feature for a Node.js backend.
