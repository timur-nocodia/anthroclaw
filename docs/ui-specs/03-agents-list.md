# Page: Agents List

## Route
`/agents`

## Purpose
View, create, and delete agents.

## Data Source
- `GET /api/agents` → `AgentSummary[]`

## Content

### Agent List
For each agent, display:
- **Name** (agent ID) — clickable, navigates to `/agents/{id}`
- **Model** — e.g. "claude-sonnet-4-6"
- **Routes** — count + channel badges (e.g. "2 TG, 1 WA")
- **Skills** — count
- **Queue mode** — collect/steer/interrupt
- **Session policy** — never/hourly/daily/weekly

### Actions per Agent
- **Edit** → navigates to `/agents/{id}`
- **Test** → navigates to `/chat/{id}`
- **Delete** → confirmation dialog: "Delete agent '{name}'? This removes all files, skills, and memory." → DELETE `/api/agents/{id}`

### Create Agent
- Button: "New Agent"
- Dialog with fields:
  - **Agent ID** (text input): slug format, lowercase, hyphens. Validated: no spaces, no special chars, unique.
  - **Model** (select): list of available models. Default: claude-sonnet-4-6
  - **Base template** (select): "Blank" or "Example" (copies from example agent if it exists)
- On submit: POST `/api/agents` with `{ id, model, template }`
- On success: navigate to `/agents/{id}`

## Empty State
"No agents yet. Create your first agent to get started." + "New Agent" button.

## Error States
- API error: toast with error message
- Delete fails: toast "Failed to delete agent: {reason}"
