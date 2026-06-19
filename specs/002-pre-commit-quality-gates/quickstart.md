# Quickstart: Validating Pre-Commit Quality Gates

Use this guide to verify the hook system works end-to-end after implementation.

**Prerequisites**: Node.js installed, dependencies installed (`npm install`), implementation complete.

---

## Step 1: Verify Husky is Active

After `npm install`, confirm `.husky/pre-commit` exists and is executable:

```bash
cat .husky/pre-commit
# Expected output: something like "npx lint-staged"
```

---

## Step 2: Test — Lint Error Blocks Commit (SC-001, FR-001, FR-002)

```bash
# 1. Create a file with a known lint error
echo "var x = 1" >> src/test-lint-gate.js

# 2. Stage it
git add src/test-lint-gate.js

# 3. Attempt commit
git commit -m "test: lint gate"
# Expected: commit REJECTED with error:
#   no-var: Unexpected var, use let or const instead (line 1)
#   prefer-const: 'x' is never reassigned. Use 'const' instead (line 1)

# 4. Clean up
git restore --staged src/test-lint-gate.js
rm src/test-lint-gate.js
```

---

## Step 3: Test — Formatting Error Blocks Commit (FR-008, FR-010)

```bash
# 1. Create a file with bad formatting (4-space indent instead of 2)
cat > src/test-format-gate.js << 'EOF'
const example = () => {
    return true;
}
module.exports = { example };
EOF

# 2. Stage it
git add src/test-format-gate.js

# 3. Attempt commit
git commit -m "test: format gate"
# Expected: commit REJECTED with message that file differs from Prettier output
# File remains UNCHANGED (report-only, no auto-fix)

# 4. Clean up
git restore --staged src/test-format-gate.js
rm src/test-format-gate.js
```

---

## Step 4: Test — Secrets Detection Blocks Commit (SC-006, FR-008)

```bash
# 1. Create a file with a fake API key pattern
cat > src/test-secret-gate.js << 'EOF'
// Do not commit real keys
const FAKE_AWS_KEY = "AKIAIOSFODNN7EXAMPLE";
module.exports = {};
EOF

# 2. Stage it
git add src/test-secret-gate.js

# 3. Attempt commit
git commit -m "test: secrets gate"
# Expected: commit REJECTED with secretlint reporting a potential AWS key

# 4. Clean up
git restore --staged src/test-secret-gate.js
rm src/test-secret-gate.js
```

---

## Step 5: Test — Staged-Only Check (FR-003, User Story 2)

```bash
# 1. Create a file with a lint error but do NOT stage it
echo "var badCode = 1" >> src/test-unstaged.js

# 2. Stage a clean file
echo "const clean = true;\nmodule.exports = { clean };" > src/test-clean.js
git add src/test-clean.js

# 3. Commit — should succeed despite the unstaged bad file
git commit -m "test: only staged files checked"
# Expected: commit SUCCEEDS — unstaged test-unstaged.js is not checked

# 4. Clean up
git rm --cached src/test-clean.js
git restore --staged src/test-unstaged.js 2>/dev/null; rm src/test-clean.js src/test-unstaged.js
```

---

## Step 6: Test — Performance (SC-002)

```bash
# Stage 5 files from src/ and time the commit
git add src/app.js src/config/env.js src/config/logger.js src/config/database.js src/config/socket.js
time git commit -m "test: performance check"
# Expected: checks complete in under 10 seconds
# If over 10 seconds, review secretlint performance for large files

# Undo the test commit
git reset HEAD~1
```

---

## Step 7: Test — Clean Commit Passes (User Story 1, SC-001)

```bash
# Make a minimal valid change, stage it, commit
# The commit should succeed with no errors reported
```

---

## Step 8: Test — New Developer Onboarding (SC-003)

On a fresh clone:

```bash
git clone <repo-url>
cd easyorder-partners-api
npm install
# Expected: .husky/pre-commit hook is active (no extra steps needed)
# Verify by attempting a bad commit — it should be rejected
```

---

## Manual Check Commands (FR-005)

Run these at any time without a git commit:

```bash
npm run lint            # ESLint report (all src/ files)
npm run format:check    # Prettier format report (all src/ files)
npm run secrets:check   # Secretlint report (all src/ files)
```

All three should exit with code `0` (no errors) after the baseline cleanup pass.

---

## References

- Hook behavior details: [contracts/hook-behavior.md](contracts/hook-behavior.md)
- Configuration entities: [data-model.md](data-model.md)
- Tool decisions: [research.md](research.md)
