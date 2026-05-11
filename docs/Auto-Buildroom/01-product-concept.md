# Product Concept

Status: Draft

Purpose: define what AnthroClaw Auto-Buildroom is, who it is for, what problem it solves, and why "agents with receipts" is the core product wedge.

## One-Liner

Buildroom is where AnthroClaw turns agent work from chat output into accountable work artifacts.

Shorter:

```text
Receipts for autonomous agent work.
```

## Product Thesis

AnthroClaw Auto-Buildroom is a control room for autonomous AI agents.

It is not "an agent that does everything by itself." It is a system where agents can notice useful work, explain why it matters, request approval, build within a bounded scope, get checked by an independent role, and leave receipts the operator can inspect.

The core product belief:

```text
Autonomous agents should not just act.
They should leave receipts.
```

Auto-Buildroom turns autonomy from a black-box loop into an inspectable workflow.

## Problem

Most agent systems still look like this:

```text
User asks -> Agent does something -> Agent says "done"
```

That is useful for direct task execution, but it does not create enough trust for autonomous initiative.

The operator often cannot tell:

- why the agent decided this work mattered;
- where the task came from;
- what evidence supported it;
- who approved the scope;
- what the agent was forbidden to touch;
- what the builder claimed after the work;
- whether QA independently verified those claims;
- whether the final "done" state should be trusted.

Without this structure, agents tend to fall into one of three bad modes:

- too passive: they wait for exact commands;
- too dangerous: they act without meaningful approval;
- too noisy: they generate ideas and tasks without improving the system.

## Product Category

Auto-Buildroom is not a task manager.

A task manager stores work items. Auto-Buildroom stores the chain of reasoning, approval, execution, verification, and trust around agent work.

Auto-Buildroom is not an AutoGPT-style loop.

AutoGPT-style systems often optimize for continuous autonomous action:

```text
agent decides -> agent acts -> agent loops
```

Auto-Buildroom optimizes for bounded autonomy:

```text
agent notices -> separate review -> approval -> scoped build -> independent QA -> trust report
```

Auto-Buildroom is not a replacement for the native AnthroClaw agent runtime.

It is a control and trust layer around agent work. The native runtime still owns sessions, tools, permissions, approvals, cancellation, and logs.

## Product Promise

An operator should be able to say:

```text
Find important work in this project, propose it, but do not build without approval.
```

Auto-Buildroom should then:

1. collect signals;
2. create evidence-backed research;
3. propose a bounded idea;
4. separate weak signals from real work;
5. request approval when needed;
6. build only within approved scope;
7. run independent QA;
8. compare builder claims against QA evidence;
9. produce a trust report;
10. save the receipt chain.

## Target User

The first user for v0.1 is a developer/operator running AnthroClaw on a local repository.

This is not initially a no-code product, marketplace, or enterprise platform. The first user already understands agents, repos, docs, tests, and approvals. They want more autonomous initiative from agents without losing control.

Primary users:

- AI builders using AnthroClaw, Claude Code, Codex, Hermes, OpenCode, or similar agent tools;
- solo founders and indie hackers who want an AI team without manually managing every role;
- engineering teams that need audit trails, scoped execution, approval gates, and QA evidence;
- product/content operators who want the same receipt chain for research, release notes, content plans, and experiments.

The long-term vision can support a self-improving organization, but v0.1 should prove the local developer/operator loop first.

## Agent vs Buildroom

AnthroClaw should expose two related but distinct concepts:

```text
Agent = conversational worker.
Buildroom = coordinated agent squad with receipts.
```

Ordinary agents remain ordinary. They can chat, use tools, remember context, and respond through configured routes.

A Buildroom is different. It is a structured workflow made from roles, policies, artifacts, approvals, and trust states. It may use multiple AnthroClaw agents internally, but product-wise it appears as one operating room for accountable work.

## Core Roles

Auto-Buildroom is easiest to understand as a squad:

- Research observes the world and preserves evidence.
- Subconscious notices repeated signals and develops taste.
- Signal Filter separates thoughts from real work.
- Main Review decides whether work is worth doing and locks scope.
- Builder executes only inside the approved contract.
- QA independently checks what Builder claims.
- Verification Delta compares Builder claims against QA evidence.
- Trust Report explains what can and cannot be trusted.
- Retention decides whether the result should be kept, improved, parked, pruned, ghosted, or reopened.
- Operator View shows the human what happened and what decision is needed.

The important product boundary:

```text
A thought is not a task.
A wish is not a plan.
A signal is not approval.
Coder does not grade its own homework.
```

## Non-Negotiables For v0.1

These constraints protect Auto-Buildroom from becoming another uncontrolled self-driving agent loop.

1. The first user is a local developer/operator running AnthroClaw on a repo.
2. The user creates a Buildroom, not just another agent.
3. Ordinary agents remain ordinary unless explicitly connected as signal sources.
4. Buildroom may observe or receive handoffs from ordinary agents, but ordinary agents do not get approval or build powers by default.
5. v0.1 uses manual approval only.
6. The first real-world demo uses a safe docs/test/operator-summary improvement, not production mutation, external posting, or autonomous config changes.
7. No role may approve, verify, or retain an artifact it produced.
8. Builder cannot mark QA as passed.
9. Missing QA evidence prevents a `clean` trust state.
10. Receipts are durable artifacts, not just chat messages.

The most valuable product line is the boundary between initiative and permission.

## v0.1 Promise

v0.1 does not promise a fully autonomous AI employee, a marketplace, a dashboard platform, or self-modifying production automation.

v0.1 promises:

```text
agent work becomes structured, inspectable, and approvable
```

That means a user can see where work came from, what was approved, what was built, what was verified, and what level of trust the system assigns to the result.

## v0.1 Scenario

The first complete scenario should be:

1. Operator creates a Buildroom for the local AnthroClaw repo.
2. Research role inspects repo, docs, tests, and recent sessions.
3. Dreamer proposes one safe improvement.
4. Main Review converts it into a bounded proposal.
5. Operator manually approves.
6. Builder runs within allowed scope.
7. QA independently checks.
8. Verification Delta compares claims versus evidence.
9. Trust Report explains the result.
10. Receipt chain is saved.

Recommended demo improvement:

```text
Improve AnthroClaw operator summary documentation/test/example.
```

This scenario is useful enough to be real, but safe enough for the first proof. It avoids public posting, production config mutation, external side effects, and broad code rewrites.

## What Counts As A Receipt

A receipt is not merely a Markdown summary.

A receipt is a durable artifact that records:

- artifact ID;
- role that produced it;
- run ID;
- parent artifact IDs;
- timestamp;
- status;
- evidence;
- claims;
- limitations or missing evidence;
- redaction status;
- hash or traceability metadata.

Receipts should be operator-readable, but they must also be structured enough for policy checks and future automation.

## Product Wedge

The strongest wedge is:

```text
Agents with receipts.
```

Expanded:

```text
Control plane for agents that think, build, verify, and report with receipts.
```

User-facing:

```text
Let your agents find and build useful work without losing control.
```

## What This Is Not

Auto-Buildroom is not:

- a fully autonomous production changer;
- a replacement for AnthroClaw's native Agent SDK runtime;
- a general-purpose task manager;
- a public content autoposter;
- a marketplace;
- a dashboard-first product;
- a system where one agent invents, approves, builds, and grades its own work.

## Success Criteria

The product concept is working when an operator can look at a completed Buildroom run and answer:

- what did the agent notice?
- why did it matter?
- what evidence supported it?
- who approved it?
- what scope was allowed?
- what did Builder claim?
- what did QA confirm?
- what remains unproven?
- what trust state did the system assign?
- what should the operator do next?

Final product claim:

```text
AnthroClaw Auto-Buildroom turns autonomous agents from black-box doers into accountable teammates.
```
