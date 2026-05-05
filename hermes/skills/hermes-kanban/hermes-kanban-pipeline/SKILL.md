---
name: hermes-kanban-pipeline
description: Kanban ticket creation and fan-out coding pipeline — Pattern A (bulk triage tickets) and Pattern B (parallel engineer + reviewer pipeline)
---

## Trigger conditions

- User asks to "add tickets", "create tickets", "add items to the board" → use **Pattern A**
- User asks to "set up a coding pipeline", "create a story 4 pipeline", or "run the coding workflow" → use **Pattern B**
- New feature requires parallel backend + frontend + review → use **Pattern B**

## All operations use the CLI

All kanban operations must use `hermes kanban` commands — never access the database directly.

| Operation | CLI command |
|-----------|-------------|
| Create a task | `hermes kanban create "Title" --body "Body" --assignee pm --workspace scratch` |
| Create with worktree | `hermes kanban create "Title" --body "Body" --assignee developer --workspace worktree` |
| Create in triage | `hermes kanban create "Title" --triage` |
| Link parent → child | `hermes kanban link PARENT_ID CHILD_ID` |
| Assign task | `hermes kanban assign TASK_ID PROFILE` |
| Mark done | `hermes kanban complete TASK_ID` |
| Show task details | `hermes kanban show TASK_ID` |
| List tasks | `hermes kanban list` |
| Add comment | `hermes kanban comment TASK_ID "Comment text"` |
| Force-load skill | `hermes kanban create "Title" --skill skill-name` |
| Set runtime cap | `hermes kanban create "Title" --max-runtime 30m` |

## Decomposition Principles

Before creating tasks, decompose the work following these rules:

1. **Small scope, dependent chains**: Each task should be completable in a single focused work session. Chain dependent tasks explicitly (T1 → T2 → T3). Even if all tasks belong to one ticket, decompose so each engineer works on a narrow, well-defined slice.

2. **Parallelize where possible**: If tasks have no dependency between them, make them siblings that can run in parallel. Use `hermes kanban link` to express dependencies: parent blocks children, multiple parents can block one child (reviewer waits for all).

3. **Test-first, compiler-driven**: Every task body MUST instruct the engineer to run the build first (`./build.sh` or check README), write failing tests before production code, and let the compiler/tests drive implementation.

4. **Task body template**: Include what needs to be built, which files/modules are involved, test requirements, dependencies on parent outputs, and the build command to use.

## Two Patterns

This skill covers two kanban task-creation patterns:

### Pattern A — Simple / Bulk ticket creation (no pipeline, no worktrees)

Use when the user asks to "add tickets", "create tickets", or "add items to the board". Tasks go directly to triage with a PM assignee. No worktrees, no fan-out, no engineer tasks.

```bash
# Create triage tickets
hermes kanban create "Ticket title" --body "Detailed description" --assignee pm --workspace scratch --triage
hermes kanban create "Another ticket" --body "Another description" --assignee pm --workspace scratch --triage
```

### Pattern B — Fan-out coding pipeline

Use when the user asks to "set up a coding pipeline", "create a story 4 pipeline", or "run the coding workflow". Creates the full three-layer graph: pm parent → parallel engineers → reviewer.

```bash
# 1. Create parent task (PM workspace, reads main repo)
hermes kanban create "Feature: ..." --body "Feature description" --assignee pm --workspace dir:/path/to/repo

# 2. Create engineer tasks with worktree workspace
hermes kanban create "Backend: ..." --body "Task body with test-first instructions" --assignee developer --workspace worktree
hermes kanban create "Frontend: ..." --body "Task body with test-first instructions" --assignee developer --workspace worktree

# 3. Create reviewer task
hermes kanban create "Review: ..." --body "Review accumulated changes" --assignee reviewer --workspace worktree

# 4. Link: parent blocks engineers, engineers block reviewer
hermes kanban link PARENT_ID BACKEND_ID
hermes kanban link PARENT_ID FRONTEND_ID
hermes kanban link BACKEND_ID REVIEWER_ID
hermes kanban link FRONTEND_ID REVIEWER_ID
```

For sequential developer chains (T1 → T2 → T3 all assigned to developer), use `--workspace worktree` on all of them — the dispatcher reuses the same worktree so changes accumulate:

```bash
hermes kanban create "T1: data model" --body "..." --assignee developer --workspace worktree
hermes kanban create "T2: repository" --body "..." --assignee developer --workspace worktree
hermes kanban create "T3: service layer" --body "..." --assignee developer --workspace worktree
hermes kanban create "T_review" --body "..." --assignee reviewer --workspace worktree

hermes kanban link PARENT_ID T1
hermes kanban link T1 T2
hermes kanban link T2 T3
hermes kanban link T3 T_REVIEW
```

## Profile workspace rule

Engineer and reviewer tasks use `workspace_kind = 'worktree'`. The `workspace_path` comes from the task's `workspace_path` field — the dispatcher provides it. Never hardcode project paths in profiles.

## Profile structure

- **pm/SOUL.md** — decompose, create tasks with `--workspace worktree`, fan-out, link, assign. Never implement.
- **developer/SOUL.md** — reads from task's `workspace_path`. No hardcoded project paths.
- **reviewer/SOUL.md** — same. Read-only review.

## Dispatcher cascade

When a parent task transitions to `done`:
- `recompute_ready()` marks child tasks as `ready`
- Dispatcher claims and spawns workers for each

When all parent tasks of a child are `done`:
- `recompute_ready()` marks that child as `ready`
- Dispatcher spawns the worker

## Dispatcher configuration

The dispatcher is controlled by these `config.yaml` keys under the `kanban:` section:

```yaml
kanban:
  dispatch_in_gateway: true      # default; dispatcher runs inside gateway
  dispatch_interval_seconds: 60  # tick interval; lower = snappier pickup
  max_parallel_tasks: 2          # global cap on simultaneously-running tasks
  claim_ttl_seconds: 900         # claim liveness window in seconds (default: 900 = 15 min)
```

`max_parallel_tasks` limits how many tasks can be `running` **across all boards simultaneously**. It is enforced at the top of each `dispatch_once()` tick via a cross-board `concurrency_limit` check (see [references/dispatch-concurrency.md](references/dispatch-concurrency.md) for the full mechanics).

`claim_ttl_seconds` controls how long a task's claim remains valid before being considered stale. Workers that exceed this window without calling `heartbeat_claim()` will have their task automatically reclaimed and re-queued on the next dispatcher tick. Set this to match your longest expected single-task runtime.

The limit is global, not per-board. If you have 3 boards each with ready tasks and `max_parallel_tasks: 2`, only 2 total workers will ever be running at once — they are claimed in priority/order until the cap is reached, and remaining ready tasks queue until a running task completes.

## Pitfalls

1. **Using `scratch` workspace instead of `worktree`** — causes `resolve_workspace()` to return a temp dir instead of a real worktree, breaking the git worktree pattern.

2. **Hardcoding project paths in profiles** — makes profiles non-portable. Always use the task's `workspace_path` field.

3. **Missing task_links** — without `blocks` links, `recompute_ready()` never promotes downstream tasks. The cascade only works with links.

4. **Creating tasks in the wrong order** — parent must exist before linking to it.

5. **`max_parallel_tasks` is global, not per-board** — the concurrency cap counts `running` tasks across ALL boards. A board with 10 ready tasks and `max_parallel_tasks: 2` will only get 2 of them through per tick; the rest wait in `ready`. This is intentional but can be surprising when boards are used as isolated project queues.

6. **`dispatch_interval_seconds` applies per-gateway-instance** — if you run multiple gateway instances against the same `HERMES_HOME`, each instance runs its own dispatcher loop independently. Only one gateway instance should have `dispatch_in_gateway: true` for a given `HERMES_HOME` to avoid double-claims.

7. **Claim TTL (15 min default) vs. per-task `max_runtime_seconds`** — `claim_ttl_seconds` is a liveness guard: tasks not heartbeated within the window are reclaimed and re-queued. It has nothing to do with iteration budgets. `max_runtime_seconds` (set via `kanban create --max-runtime`) is the actual hard runtime cap — when exceeded the dispatcher SIGTERMs/SIGKILLs the worker. If tasks are timing out at 15 minutes with no apparent progress, the worker is simply not calling `heartbeat_claim()` often enough (or at all); the fix is either to heartbeat, or to raise `claim_ttl_seconds` to give the worker more time before reclamation.

8. **Backend marked `done` without wiring route in Application.kt** — a backend-eng task can be marked done while the route is still unregistered (missing import + instantiation in `routes()`). Engineer profiles MUST verify: (a) new files are `git add`ed and committed, (b) `Application.kt` or equivalent has the required import and registration, (c) `./gradlew test` (or equivalent) passes before declaring done. A reviewer blocking on "route not registered" means the backend did not complete its contract.

9. **Reviewer workspace_path can diverge from actual worktree** — the `workspace_path` field on a reviewer task is set at creation time and may not match where the backend's worktree actually lives (especially when the backend uses a different workspace naming scheme). Reviewer profiles should NOT assume `workspace_path` is valid; always verify the directory exists before working. Use `hermes kanban show <id>` which resolves and reports the actual path, or probe with `ls $workspace_path` before `cd`-ing.

10. **Pre-existing compilation errors block targeted test runs** — `./gradlew test` run from the workspace root may fail due to unrelated untracked files (e.g. GLI-017 RetentionRoute blocking GLI-016 AnalyticsApiRoute tests). Engineers should run targeted tests: `./gradlew test --tests "dev.glimpse.web.AnalyticsApiRouteTest"` or compile only affected modules to confirm correctness before marking done.

## Verification

```bash
# List all non-archived tasks with status and assignee
hermes kanban list

# Show a specific task with full details
hermes kanban show TASK_ID

# View task stats
hermes kanban stats
```

Expected for a working pipeline: parent=done, engineers=running or done, reviewer=todo or running, links correctly express fan-out + pipeline.
