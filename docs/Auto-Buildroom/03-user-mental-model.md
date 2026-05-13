# User Mental Model

Status: Draft

Purpose: explain Auto-Buildroom in simple user-facing language: Research as eyes and memory, Subconscious as taste, Signal Filter as boundary, Main as decision, Builder as hands, QA as skeptic, Trust Report as honest status, and Operator View as cockpit.

## The Simple Explanation

Auto-Buildroom is an operating room for agent work.

Ordinary agents can chat, answer, code, research, or help with a task. A Buildroom does something different: it turns agent initiative into a structured chain of work artifacts.

First-screen explanation:

```text
Agents notice work.
Buildroom turns that into proposals.
You approve the scope.
Builder works inside the box.
QA checks the result.
Trust Report tells you what to believe.
```

Simple user-facing framing:

```text
Your agents can notice useful work.
Buildroom makes them explain it, get approval, build within scope, get checked, and leave receipts.
```

The user should not need to understand every internal role before they understand the product. The first mental model is:

```text
Buildroom = where agent work becomes accountable.
```

Product positioning:

```text
Auto-Buildroom is the approval and receipt layer for autonomous agent work.
```

## Agent vs Buildroom

Users should understand the distinction early.

An ordinary agent is a conversational worker:

```text
I ask -> agent answers or does a task
```

A Buildroom is a structured work system:

```text
agent notices -> system researches -> idea is reviewed -> operator approves
-> builder works in scope -> QA checks -> trust report explains result
```

This distinction prevents a common misconception: Auto-Buildroom is not "one more powerful agent." It is a control room around agent work.

## The Core Metaphor

The most useful metaphor:

```text
Research = eyes and memory
Subconscious = pattern watcher, taste, and recurring-signal detection
Signal Filter = boundary between thought and work
Main Review = conscious decision
Builder = hands
QA = skeptic
Verification Delta = claims versus evidence
Trust Report = honest status
Retention = what we keep, improve, park, or archive
Operator View = cockpit
```

This should be used in user docs, onboarding, product copy, and first-run explanations.

It is stronger than saying "multi-agent workflow" because it explains why the roles exist.

For broad user-facing copy, avoid making `Subconscious` sound mystical. Prefer:

```text
Subconscious, the pattern watcher
```

or:

```text
Subconscious notices recurring patterns. It has taste, not authority.
```

## v0.1 Trust Chain

For v0.1, the user does not need to learn every role first.

The simplest chain is:

```text
Notice -> Research -> Proposal -> Approval -> Build -> QA -> Trust Report
```

Expanded:

```text
Agents can notice and propose.
You approve the scope.
Builder works inside the box.
QA checks the evidence.
Trust Report tells you what is actually proven.
```

This should be the default onboarding path. Deeper role names such as Subconscious, Signal Filter, Main Review, Verification Delta, and Retention can be introduced after the user understands the trust chain.

## What The User Should Feel

The user should feel:

- "My agents can take initiative, but not run away."
- "I can see why something was proposed."
- "I can approve or reject before work happens."
- "The build is scoped."
- "The agent does not grade its own work."
- "The result has an honest trust status."
- "I can inspect the receipt chain later."

The user should not feel:

- "I now have seven separate agents to manage."
- "The system is secretly changing my project."
- "Any chat message can become approval."
- "Every interesting thought becomes a task."
- "I have to read raw JSON to know what happened."

## The Most Important Boundary

Auto-Buildroom exists to protect the boundary between initiative and permission.

The system may autonomously:

- observe;
- summarize;
- notice repeated signals;
- propose work;
- explain evidence;
- draft a plan.

The system must not autonomously, in v0.1:

- approve its own proposal;
- run a build without explicit operator approval;
- expand scope after approval;
- treat handoff as approval;
- treat a vague "yes" in ordinary chat as durable approval;
- claim `clean` trust without QA evidence.

User-facing rule:

```text
Agents may suggest.
Buildroom requires approval before execution.
```

## Thought, Signal, Task, Approval

Users need these concepts separated.

### Thought

A thought is something an agent noticed.

Example:

```text
"The operator summary docs seem unclear."
```

A thought is not actionable by itself.

### Signal

A signal is a structured observation with some evidence.

Example:

```text
"Three recent sessions mention confusion around operator summaries."
```

A signal can enter Research or Subconscious, but it is still not approval.

### Idea

An idea is a proposed improvement.

Example:

```text
"Improve operator summary documentation and add a test/example."
```

An idea can be reviewed.

### Proposal

A proposal is an idea with scope, non-goals, risk, and acceptance criteria.

Example:

```text
Allowed paths: docs/**, tests/**
Blocked paths: .env, production config
Success: operator summary docs explain routing and trust state
```

### Approval

Approval is an explicit operator decision through the Buildroom operator surface.

Example:

```text
anthroclaw buildroom approve idea_123
/buildroom approve idea_123
```

Approval is not inferred from ordinary chat.

## Role Mental Models

### Research

Research is the system's eyes and memory.

It collects evidence from approved sources: repo state, docs, tests, issues, release notes, session summaries, or other configured signals.

Research does not decide what to build.

User-facing phrase:

```text
Research says what we know and how strong the evidence is.
```

### Subconscious

Subconscious notices what keeps returning.

It tracks repeated friction, recurring ideas, stale themes, and work that seems alive again. It is allowed to wander and connect patterns, but it does not build or approve.

User-facing phrase:

```text
Subconscious develops taste, not authority.
```

### Signal Filter

Signal Filter keeps the system from becoming a task generator.

It asks:

- is this just interesting?
- is it repeated?
- does it have heat?
- is it ready for review?
- should it stay watching?
- should it be parked?
- is it blocked?

User-facing phrase:

```text
Signal Filter decides whether a thought is ready to become a proposal.
```

### Main Review

Main Review is the decision layer.

It turns an idea into a bounded proposal or rejects it. It defines scope, non-goals, risk, approval requirements, and acceptance criteria.

Main Review should not execute the work.

User-facing phrase:

```text
Main Review turns an idea into a contract.
```

### Builder

Builder executes the approved contract.

Builder receives:

- what to build;
- why it matters;
- allowed paths;
- blocked paths;
- non-goals;
- verification commands;
- receipt requirements.

Builder does not decide that QA passed.

User-facing phrase:

```text
Builder works inside the box.
```

### QA

QA checks Builder's work independently.

QA verifies:

- was the approved scope followed?
- did files change only where allowed?
- did tests or checks pass?
- which Builder claims are confirmed?
- which claims are rejected?
- which claims lack evidence?

QA should not silently fix the build in the same role.

User-facing phrase:

```text
QA does not trust "done" without evidence.
```

### Verification Delta

Verification Delta compares what Builder claimed against what QA confirmed.

Example:

```text
Builder: "Added operator summary docs."
QA: confirmed

Builder: "System is ready for autonomous mode."
QA: missing evidence

Trust: watch
```

User-facing phrase:

```text
Verification Delta shows the gap between claims and proof.
```

### Trust Report

Trust Report is the honest human summary.

It says:

- what is confirmed;
- what is not confirmed;
- what risks remain;
- what status applies;
- what the operator should do next.

Trust states:

```text
clean       evidence supports the result
watch       mostly okay, but something remains unproven
investigate significant uncertainty or rejected claims
blocked     unsafe, policy-violating, or not ready to proceed
```

User-facing phrase:

```text
Trust Report replaces "done" with an evidence-backed status.
```

### Retention

Retention decides what happens after the work.

It may recommend:

- keep;
- improve;
- park;
- prune;
- ghost;
- reopen.

Retention prevents the system from accumulating endless stale ideas and artifacts.

User-facing phrase:

```text
Retention helps the system remember what matters and archive what does not.
```

### Operator View

Operator View is the cockpit.

It should answer:

- what did agents notice?
- why does it matter?
- what evidence exists?
- what needs approval?
- what was built?
- what did QA confirm?
- what risks remain?
- what should I decide next?

User-facing phrase:

```text
Operator View turns agent activity into decisions a human can make.
```

## What A Buildroom Run Looks Like To A User

Example v0.1 run:

```text
1. Buildroom noticed repeated confusion around operator summaries.
2. Research found docs and test gaps.
3. Dreamer proposed a safe docs/test improvement.
4. Main Review scoped it to docs/** and tests/**.
5. Operator approved the proposal.
6. Builder updated docs and added an example/test.
7. QA checked changed files and reran verification.
8. Verification Delta compared Builder claims to QA evidence.
9. Trust Report returned WATCH because autonomous mode was not part of scope.
10. Operator received a summary and receipt chain.
```

The user does not need to see every internal file by default. They need a clear status and the ability to inspect receipts when needed.

## Suggested User-Facing Copy

Short:

```text
Receipts for autonomous agent work.
```

Product:

```text
Buildroom turns agent initiative into approved, scoped, verified work.
```

Onboarding:

```text
Create a Buildroom when you want agents to find useful work, explain it, wait for approval, build within scope, and leave receipts.
```

Approval prompt:

```text
This proposal is ready for approval.
Review the scope, blocked paths, risk, and acceptance criteria before allowing Builder to run.
```

Trust summary:

```text
The build completed, but Trust is WATCH because one Builder claim lacks QA evidence.
```

## Common Misconceptions To Prevent

### "Buildroom is just another agent"

No. A Buildroom is a coordinated work system. It may use agents internally, but it is not a normal chat worker.

### "If an agent notices something, it becomes a task"

No. A thought can become a signal, a signal can become an idea, an idea can become a proposal, and only an approved proposal can become build work.

### "Auto-build means no human approval"

No. In v0.1, research and proposal generation may be autonomous, but build execution requires explicit operator approval.

### "QA is the same agent checking itself"

No. QA is a separate role. Builder cannot mark its own work as passed.

### "Receipts are just summaries"

No. Summaries are renderings. Receipts are durable structured artifacts with roles, parents, evidence, claims, timestamps, and traceability.

### "Watched agents get Buildroom authority"

No. Watched agents are signal sources only. Watching is not authority, and handoff is not approval.

## v0.1 Mental Model

For v0.1, the user should think:

```text
I have my ordinary AnthroClaw agents.
I can also create one Buildroom for this repo.
The Buildroom can notice and propose safe work.
It cannot build until I approve.
If it builds, QA checks it and Trust tells me what to believe.
Everything important leaves a receipt.
```

That is the full first mental model.

Everything beyond that, including multiple Buildrooms, visible role agents, raw session watching, broader approval routes, autonomous low-risk builds, and dashboards, should be introduced later.
