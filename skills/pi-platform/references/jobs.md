# Parallel work and durable handoff

## Two different jobs

- Deterministic scripts/checks run under the jobs supervisor and check DAG.
- Reasoning workers run as normal Pi sessions in detached tmux when the user requests that mode.

Do not build another agent orchestrator inside a shell script. The platform orchestrator owns
production task workflows; this skill's job helper runs explicit commands and reports outcomes.

## Check DAG

Declare check IDs, argv, real prerequisites and timeouts in platform-checks.json. Use a bounded
worker budget. Independent checks run together, prerequisites wait, failing prerequisites block
dependants, and any required non-success makes the aggregate fail.

One check owns each log/output directory. Split resources or add a real dependency if tasks would
mutate the same artifact. Do not serialize every check behind lint or typecheck without a reason.
Do not start nested all-CPU worker pools.

## Starting deterministic work

The command below is an interface example; replace placeholders with verified paths and a tested
notification adapter. A desktop notification requires the user's notification service.

```sh
node <skill>/scripts/jobs.ts start \
  --repo <worktree> \
  --state-dir <private-state-directory> \
  --notify-json '["notify-send","Pi task {id}","{outcome}: {result}"]' \
  -- devenv shell -- just check
```

Run --dry-run first for a new task definition. A notification executable must be present before
launch, but presence alone does not prove delivery: test the actual user's notification channel.
Use a verified callback adapter if the main agent must resume automatically. Do not assume
notify-send or tmux display-message starts a new model turn.

The supervisor must acknowledge ownership before the launcher returns. Store an unguessable run
identity, explicit argv, state/result paths, start/end time, task outcome and delivery outcome.
Use atomic state writes and restrictive permissions. Never put credentials in command arguments.

Report the ID and locations to the user, then end the turn. Resume on callback or user request,
not by calling status in a loop. If reliable delivery cannot be established, explain that boundary
rather than silently leaving the user with unmonitored work.

## Status, cancellation and recovery

Status is for an explicit user request or diagnosing a missing event. A stale supervisor must not
look indefinitely running. A failed notification does not erase a successful task result.

Cancellation validates process identity, not only a PID. Terminate the job's descendants, allow a
bounded grace period, then escalate when needed. Never kill a reused PID or an unrelated session.
Preserve logs after cancellation and failure.

The initial process-identity implementation may be Linux-specific. Check the actual script's
supported platform before launch; unsupported systems fail explicitly. Do not promise reboot
resumption for an in-memory process: durable state supports diagnosis, and resumable tasks need
their own explicit checkpoint contract.

Configure retention separately. Do not delete active jobs, open sessions or diagnostic state while
another component still needs them.

## Interactive Pi workers

Use only after the user approves model cost and the work split. Read the current Pi CLI docs.
A normal Pi session requires terminal stdin/stdout; tmux supplies them.

```sh
tmux new-session -d -s pi-platform-work -n worker -c <worktree> \
  'pi --model openai-codex/gpt-6-luna --thinking high --name platform-worker @<task-file>'
```

This model is an example selected by the user in the design session. Check availability/auth with
pi --list-models and pi auth check, never print credentials. Do not silently substitute a model.

Do not pass --print, --mode rpc, --no-extensions, --no-mcp or --no-context-files when the user asked
for normal sessions with configured extensions. Respect the user's existing extension selection;
"all enabled" is not permission to install additional extensions.

Each task file states the goal, evidence, owned files/worktree, APIs, tests, prohibition on committing
others' work, output report and notification destination. Shared-worktree writers need disjoint file
ownership. For overlapping changes use separate git_start worktrees and integrate deliberately.

Do not run git_check with an unrestricted fixing helper while other writers own files it might
change. Workers use targeted fix:false checks; the coordinator runs final integration checks after
ownership has been handed back.

Keep persisted Pi sessions available. After a crash, inspect existing work and resume the exact
session; do not create duplicate workers. Completion is a durable report with verification and
limitations, not a pane that appears idle.
