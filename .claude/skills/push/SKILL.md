---
name: push
description: Push local commits to origin/main, handling CI auto-version conflicts. Use this whenever pushing code to the HeapLens repo.
disable-model-invocation: false
---

Push local commits to origin/main, handling the CI auto-version workflow.

This project has a CI job that auto-bumps the patch version, commits `chore(release): vX.Y.Z`, tags, and pushes on every push to main. The remote is always ahead by one `chore(release)` commit after a push.

## Steps

1. **Fetch latest from remote:**
   ```
   git fetch origin main
   ```

2. **Check if remote is ahead:**
   ```
   git log HEAD..origin/main --oneline
   ```
   If there are `chore(release)` commits, proceed with step 3. If not, skip to step 5.

3. **Pull with rebase:**
   ```
   git pull --rebase origin main
   ```

4. **If there's a merge conflict in package.json** (version field conflict):
   - Keep ALL of our content changes (displayName, description, keywords, etc.)
   - Use the HIGHER version number from the `chore(release)` commit (HEAD side)
   - Resolve: `git add package.json && git rebase --continue`

5. **Push:**
   ```
   git push origin main
   ```

6. **Verify CI triggered:**
   ```
   gh run list --repo sachinkg12/heaplens --limit 2 --json displayTitle,status --jq '.[] | "\(.status)\t\(.displayTitle)"'
   ```

## Rules
- NEVER use `--force` or `--force-with-lease` unless explicitly asked
- NEVER add Co-Authored-By lines or any AI attribution
- If rebase fails for reasons other than a version conflict, stop and ask the user
