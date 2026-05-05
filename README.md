# opencode-config

Shared coding-agent config across tools. Covers [OpenCode](https://opencode.ai) (multi-pass code review), [pi](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent) (terminal coding harness), and [Hermes](https://hermes.sh) (profiles + skills).

## What's in here

### `/review` command

A pre-commit review command that fans out to four specialized reviewer agents in parallel. Each reviewer reads staged files from disk in its own fresh context, avoiding the anchoring problem of single-pass review.

Usage: stage your changes, then run `/review` in OpenCode.

### Reviewer agents

| Agent | Lens |
|---|---|
| `api-contract-reviewer` | API misuse, parameter coupling, type safety, leaky abstractions |
| `testability-reviewer` | Hidden dependencies, non-determinism, hardcoded time/IO, monetary precision |
| `responsibility-reviewer` | SRP violations, misplaced business logic, god functions |
| `test-quality-reviewer` | Mock overuse, brittle assertions, missing boundary cases |

Each reviewer has read-only file access and git-read-only bash access. No reviewer can edit code — they report findings for you to triage.

### pi extensions

TypeScript extensions for the [pi coding agent](https://www.npmjs.com/package/@mariozechner/pi-coding-agent).

| Extension | What it does |
|---|---|
| `response-stats` | Adds a footer line showing TTFT, full response duration, separated thinking/output token counts, and tokens/s. Updates live during streaming. |

## Setup

```bash
git clone git@github.com:k0zakinio/opencode-config.git ~/Projects/opencode-config
~/Projects/opencode-config/setup.sh
```

The setup script symlinks:

- `commands/` and `agents/` into `~/.config/opencode/` (or `$XDG_CONFIG_HOME/opencode/`)
- each file in `pi/extensions/` into `~/.pi/agent/extensions/`
- `hermes/profiles/*/SOUL.md` and `config.yaml` into `~/.hermes/profiles/*`
- `hermes/skills/*` into `~/.hermes/skills/*`

Existing entries are backed up to `.bak` before being replaced. If pi is already running, `/reload` to pick up the extensions.

## Hermes profiles

| Profile | Role |
|---|---|
| `developer` | Backend engineering — delegates to OpenCode |
| `pm` | Product manager — decomposes, routes, and summarizes via Kanban |
| `reviewer` | Code review and consolidation in the Kanban pipeline |

## Hermes skills

| Skill | What it does |
|---|---|
| `hermes-kanban/hermes-kanban-pipeline` | Kanban ticket creation and fan-out coding pipeline (Pattern A: bulk triage, Pattern B: parallel engineer + reviewer) |

## Tuning

The reviewer prompts are currently tuned for **Kotlin/JVM** codebases. To adapt for other languages, edit the language-specific checklist sections in each agent file.

If reviewers are too noisy, add a line like "only flag issues you would block a PR on" to the agent prompt. If too quiet, remove hedging language.
