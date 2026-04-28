---
name: lcm-usage
description: When and how to use Lossless Context Management tools (lcm_*).
---

# Using LCM Tools

You have access to a session-scoped DAG of compressed history. Use these tools when the user references something from earlier in the session that was compacted out of your active context.

## When to use which tool

- **`lcm_grep`** — search by keyword. Use when user asks "что мы говорили про X" / "find where we discussed Y". Returns top matches across raw messages and compressed summaries.

- **`lcm_describe`** — preview metadata of a node without loading content. Use to scope before drilling. With no args returns session overview.

- **`lcm_expand`** — fetch source content for a node. After `lcm_grep` returns a node_id, call `lcm_expand` to drill down. For deep nodes (D2/D3), expand iteratively (D2 → child D1s → child D0s → raw messages).

- **`lcm_expand_query`** — RAG-style: provide a natural-language `prompt` and the tool finds relevant nodes, expands them, and answers. Use for "summarize what we decided about Y across the whole session". Faster than manual grep + expand.

- **`lcm_status`** — diagnostic: how big is the DAG, how many compressions ran, last compaction time. Use rarely — for self-diagnosis or when user explicitly asks.

- **`lcm_doctor`** — health check (orphans, FTS sync, integrity). Use only when something seems wrong or operator asks.

## Distinction from `memory_*` tools

- `memory_*` tools = **long-term, cross-session memory** (wiki entries, persistent facts).
- `lcm_*` tools = **current session DAG** (compressed history of THIS conversation).

For "what did we decide last month": use `memory_search`. For "what did we discuss earlier today": use `lcm_grep`.
