---
description: Review staged Kotlin changes with four specialized reviewer subagents in parallel
---

You are orchestrating a pre-commit code review of the currently staged changes. You will not edit code. You will produce a consolidated review report and nothing else.

## Step 1 — Collect the review surface

Run exactly one command:

- !`git diff --staged --name-status`

That's it. The output is small — one line per changed file, each line a status letter (A/M/D) and a path. Capture it; you'll paste it into each reviewer's prompt verbatim.

If the output is empty, stop and tell the user there is nothing to review.

Do NOT run `git diff --staged` (without `--name-status`). Do NOT read any source files. Do NOT write any temp files. The reviewers will fetch everything they need from disk in their own fresh contexts. Your entire job is: get the file list, fan out, consolidate.

## Step 2 — Fan out to reviewers in parallel

You MUST call the `task` tool exactly **four times in a single assistant turn** so the calls run in parallel. Each call must set the subagent identifier explicitly. Do not make a single generic task call. Do not omit the subagent field. Do not serialize the calls across multiple turns.

The four required task invocations, one per call:

1. `subagent_type: api-contract-reviewer`
2. `subagent_type: testability-reviewer`
3. `subagent_type: responsibility-reviewer`
4. `subagent_type: test-quality-reviewer`

(If the tool schema in this runtime uses a different field name for the subagent — e.g. `agent`, `name`, or `subagent` — use that field. The requirement is that each of the four calls names one of the four reviewer agents above. Never call `task` without naming a specific reviewer.)

Each task prompt is tiny — a file manifest and a short instruction. Nothing else. Do NOT embed diffs, file contents, or summaries.

Each of the four calls must contain:

1. **File manifest**: paste the output of `git diff --staged --name-status` verbatim. Entries look like `A<TAB>path/to/File.kt` or `M<TAB>path/to/Other.kt` or `D<TAB>path/to/Old.kt`.
2. **Instruction**: "For each file in the manifest with status A or M, use your Read tool to read the current file content. If you want to see what changed in a modified file, run `git diff --staged -- <path>` via your bash tool. Added files are wholly new, so the file content IS the change. Skip files with status D. Then review according to your assigned lens."

That is the entire task prompt. Keep it under ~150 tokens plus the manifest. The reviewers fetch everything they need from disk and git in their own contexts, in parallel.

All four calls receive the same manifest and instruction — only the target subagent differs.

## Step 3 — Consolidate findings

Produce a single markdown report with this exact structure:

```
# Pre-commit Review

## API Contract Reviewer
<findings or "No issues found.">

## Testability Reviewer
<findings>

## Responsibility Reviewer
<findings>

## Test Quality Reviewer
<findings>
```

Each finding within a section must include a `file:line` reference and a concise explanation. Do not merge findings across reviewers, do not rank, do not editorialize. If a reviewer returned nothing, write "No issues found." under its heading.

After the report, add a single line: `Run /review again after addressing findings, or commit as-is.`

## Hard rules

- Do not edit any files.
- Do not apply fixes.
- Do not invoke reviewers sequentially — they must fan out in one turn.
- Do not add your own review commentary outside the four reviewer sections.
