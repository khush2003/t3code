# Atlas project orchestration

Atlas turns a project brief into work that agents can execute and reviewers can accept.
Open **Atlas** from the sidebar on web or desktop, choose a connected environment and
project, and describe the outcome and deliverables in a new initiative.

Use a planning agent to break the brief into concrete tasks. Each task should have
acceptance criteria, a specialty, and dependencies. Inspect the proposed tasks before
publishing GitHub issues or starting implementation. GitHub publishing uses the selected
project's origin repository and the GitHub CLI login on the host environment.
Install `gh` and sign in on that host before publishing. Only GitHub.com repositories
are supported in this first version.

Start ready tasks with a provider and model available on the selected environment.
The agent control pane links to the backing conversations so you can inspect the work,
answer questions, stop a run, and see the result. This first version runs one implementation
task at a time per project to keep agents from editing the same checkout concurrently.
Dependent tasks become ready after their prerequisites are approved.

A completed agent run still needs review. Approve the deliverable or request changes with
feedback. Agent review provides another pass over the work. By default, inspect its findings
before accepting a deliverable. Enable **Apply the review decision automatically**
when starting a review to let a valid verdict accept the task or request changes.
The server applies that decision even when the Atlas workspace is closed, and records whether
a human or review agent made it. A failed review or an unreadable verdict never accepts the work. Retry failed work after resolving the reported problem.

Initiatives belong to the environment hosting the project. Other clients connected to that
environment can read the same records. The Atlas workspace is currently available on web
and desktop; use those clients for planning and review.

You can edit the brief and deliverables or delete an idle initiative. Plans with
execution history or published issues cannot be replaced by an import; create another
initiative when changing the scope of work. Finish or stop active runs before deleting
an initiative.
