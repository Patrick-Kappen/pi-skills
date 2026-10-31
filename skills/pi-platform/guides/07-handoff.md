# 7. Handoff and wait

1. Read the jobs reference. Decide whether the work has a reliable owner after this turn ends.
   pi-git's PR watcher already owns CI after git_pr; do not wrap it in another watcher.
2. For deterministic long work, validate the notification adapter and start jobs with a unique
   state directory, explicit argv, bounded concurrency inside the check DAG and private log files.
   Report the returned ID, command, log/result locations and how to cancel.
3. End the turn after the supervisor acknowledges ownership. Resume only on its completion/error
   event, a user request, or a diagnosed missing notification. No sleep loops or repeated status
   calls by the agent.
4. A desktop notification is user-visible delivery, not necessarily a new model turn. If the
   environment has no agent callback, say that the user must resume the session; do not claim
   automatic continuation. Preserve the result for recovery.
5. For normal interactive Pi workers in detached tmux, keep the user's configured extensions.
   Use separate worktrees or strict file ownership and explicit report paths. Keep sessions
   inspectable; task completion is a report, not merely an idle terminal.
6. On failure preserve work and the diagnostic artifact, distinguish a task error from a notifier
   error, and ask only for a real decision/permission. Do not keep retrying a known provider or
   configuration failure.
7. On success summarize files changed, checks and next owner. Keep state until the retention policy
   permits cleanup; never remove a live job or another session's worktree.

Result: the user knows what is running, who owns it and what event will resume the workflow.
