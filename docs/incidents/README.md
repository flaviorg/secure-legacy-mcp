# Incidents

A record of real failures during the construction and use of the project. Nothing here is made up: if it did not happen, it does not go in.

## Post-mortem template

```markdown
## YYYY-MM-DD: short title

- **Impact:** what stopped or went wrong, and for how long.
- **Detection:** how and when it was noticed.
- **Root cause:** the mechanism, not the culprit.
- **Fix:** what was done at the time.
- **Prevention:** the test, rule or process that stops a repeat.
```

## Incidents that occurred

The project has never been published or deployed, so there was no user-facing incident. During construction there was one process incident:

## 2026-10-04: red suite left behind by an interrupted run

- **Impact:** `npm test` ended with 1 failure (`[PKG-03] .vscode/mcp.json is valid JSON ...`, `ENOENT`) until the next run. The deliverables of tasks 24 to 29 were on disk and green, but not recorded in the progress log.
- **Detection:** the next run ran the suite before any change, as the process requires, and saw the failure.
- **Root cause:** construction runs in blocks of tasks. One run stopped between Step 1 of Task 30 (test written and red, as TDD asks) and Step 3 (create `.vscode/mcp.json` and `docs/clients/README.md`). The progress log was only written at the end of a block, so nothing said what was half done.
- **Fix:** Step 3 of Task 30 was done with the content from the plan, and the test passed. The tasks with no record were checked against the plan and the spec, and a mutation test (48 mutants) found 8 test gaps, closed with tests seen failing against the mutant.
- **Prevention:** every run starts by running `npm test` and `npm run typecheck` and fixes whatever is red before going on. The `.githooks/pre-commit` hook stops a commit with a red suite.
