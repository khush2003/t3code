# Atlas project orchestration

Atlas turns a project brief into work that agents can execute and reviewers can accept.
Open **Atlas** from the sidebar on web or desktop. The overview collects reviews, agent
questions, and proposed plans from every project in the environment, so start there to see
what needs you. Pick a project, then describe the outcome and deliverables in a new
initiative.

Use a planning agent to break the brief into concrete tasks. Each task should have
acceptance criteria, a specialty, and dependencies. Inspect the proposed tasks before
publishing GitHub issues or starting implementation. GitHub publishing uses the selected
project's origin repository and the GitHub CLI login on the host environment.
Install `gh` and sign in on that host before publishing. Only GitHub.com repositories
are supported in this first version.

Start ready tasks with a provider and model available on the selected environment.
The **Agents** panel shows questions and approval requests from running agents and their
child agents. Answer them directly in Atlas, or open the backing conversation to inspect the
work, stop a run, and see its result.

Choose **New worktree** when launching independent tasks in parallel. Tasks sharing the project
checkout or the same worktree run one at a time. A new worktree starts from committed code at
the selected base ref; integrate prerequisite deliverables into that ref before starting dependent
work there. Re-runs keep their previous workspace unless you choose a new one.
Dependent tasks become ready after their prerequisites are approved. Dependencies represent
required outputs, not a suggested order: independent tasks can share a stage and run together.
Use the task list's bulk actions to launch ready work in separate worktrees,
approve reviewed deliverables, or publish and update GitHub issues. Each action previews its eligible tasks and
reports any individual failures so successful work does not need repeating.

Enable **Auto review** on an initiative to start a reviewer as soon as each implementation task
finishes, even while Atlas is closed. Choose the reviewer provider and model once for that
initiative. Existing completed tasks without a review are also picked up. Failed reviews remain
visible for manual retry; the system does not accept an unreadable or failed verdict.

A completed agent run still needs review. Approve the deliverable or request changes with
feedback. Agent review provides another pass over the work. By default, inspect its findings
before accepting a deliverable. Enable **Apply the review decision automatically**
when starting a review to let a valid verdict accept the task or request changes.
The server applies that decision even when the Atlas workspace is closed, and records whether
a human or review agent made it. A failed review or an unreadable verdict never accepts the work. Retry failed work after resolving the reported problem.

Initiatives belong to the environment hosting the project. Other clients connected to that
environment can read the same records. The Atlas workspace is currently available on web
and desktop; use those clients for planning and review.

Use **Adjust plan** when discoveries change the remaining work. Edit unstarted tasks and their
dependencies, add follow-up work, or remove untouched tasks. You can also ask a planning agent
to propose an adjustment based on current progress and results, then inspect and apply the patch.
Adjustments preserve existing task IDs, results, reviews, and published issue links. Tasks that
already started are preserved; add follow-up tasks to change their scope. Published issues keep
their links when an unstarted task is edited and are marked for an explicit issue update. Use
the publish/sync action to bring GitHub up to date. Published tasks cannot be removed.
If the plan changed after a proposal was prepared, refresh the proposal before applying it.

A full re-plan is still available for replacing an untouched plan. Plans with work history cannot
be replaced through import. You can edit the brief and deliverables or delete an idle initiative;
finish or stop active runs before deleting it.
