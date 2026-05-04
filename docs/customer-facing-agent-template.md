# Customer-facing agent template

When configuring an agent that talks to **external customers** (sales,
support, intake), the agent's system prompt MUST include the addendum
below and the agent's `mcp_tools` MUST include `escalate`. Without these
guardrails the agent will, under prompt-injection or unfamiliar requests,
hallucinate plausible technical excuses ("operator console is disabled",
"I'm waiting for a config update", "my supervisor needs to fix
something") that confuse customers and leak internal architecture.

This template was added in v0.8.0 alongside the capability-cutoff PR
(spec: `docs/superpowers/specs/2026-05-04-capability-cutoff-design.md`,
Subsystem 6).

## 1. Addendum to add to `agents/<id>/CLAUDE.md`

Insert near the top of the agent's system prompt — after the persona /
identity block, before behavioural instructions. If the agent uses
`@./*.md` imports, drop this block into the file that's imported first
(e.g. `SOUL.md` for personality-led agents).

```markdown
## Talking to clients

You are speaking with external customers. They do not know how the
system behind you is built — and they should not. Never volunteer or
invent details about internal architecture, plugins, configs, MCP tools,
operator consoles, escalation systems, or who built you. Mentioning
these confuses clients and undermines trust.

When you cannot do what a client asks:
- Do NOT invent a technical reason ("operator console is disabled",
  "the config is broken", "I'm waiting for my supervisor to fix
  something").
- DO say plainly, in the client's language: "Я не могу сделать это
  прямо сейчас. Передам Тимуру — он свяжется с тобой." (or the
  equivalent in whichever language you are using.)
- If the inability is permanent (you genuinely lack the capability),
  use the `escalate` tool to route the question to a human operator.
  Do not improvise a workaround that involves describing the system to
  the client.

Refusal must always be **plain**, not technical.
```

## 2. Add `escalate` to `agents/<id>/agent.yml`

```yaml
mcp_tools:
  # ... your existing tools ...
  - escalate
```

`escalate` is a built-in tool registered in `src/agent/agent.ts`. It
appends one JSON line per call to
`<OC_DATA_DIR>/escalations/<agentId>.jsonl` with `{ ts, agentId, summary,
urgency, suggested_action }`. Operator-side surfacing (UI, webhooks,
etc.) is out of scope for v0.8.0; for now the operator reads the JSONL
directly:

```bash
docker exec anthroclaw-app-1 sh -c 'tail -f /app/data/escalations/<agentId>.jsonl' | jq .
```

## 3. Production agents that need this addendum (as of 2026-05-04)

- `leads_agent` (Amina) — sales / qualification of inbound leads
- Any future intake / support agent

Personal-assistant agents (e.g. `timur_agent`) and operator-internal
agents do NOT need this addendum — their interlocutor knows the system.
