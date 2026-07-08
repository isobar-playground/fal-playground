---
name: goal
description: Sweep through every agent-ready GitHub issue sequentially, spawning one /implement subagent per issue with a fresh context window.
disable-model-invocation: true
---

# Goal

**Sweep** through every agent-ready GitHub issue in order — one subagent per issue, fresh context per issue — until the queue is empty.

## Steps

### 1. Build the queue

Fetch open issues labelled `agent-ready` (or the label configured in `AGENTS.md`) via `github-pull-request_doSearch`, sorted ascending by issue number.

_Completion criterion_: ordered list of issue numbers, titles, and body URLs.

### 2. Confirm

Print the queue. Wait for the human's go-ahead before sweeping.

### 3. Sweep

For each issue in order:

1. Fetch the full issue body via `github-pull-request_issue_fetch`.
2. Find the PRD: check `docs/prd/` or a URL in the issue body. If none, proceed without.
3. Spawn a subagent (default agent) with this prompt:
   ```
   PRD: <prd content, or "none">

   Issue #<number> — <title>:
   <full issue body>

   /implement
   ```
4. Wait for the subagent to return. On failure or blocker, **pause** the sweep and surface the problem before continuing.

_Completion criterion per issue_: subagent committed and reported success.

### 4. Report

List: implemented issues, skipped issues (with reason), open blockers awaiting human input.

## Notes

- Start in a **fresh context window** — not from inside an active planning or grilling thread.
- Issues from `/to-issues` are already agent-ready; no triage needed.
- Sequential sweep is intentional: fresh context per issue keeps each subagent in the smart zone.
