# Page: Agent Editor

## Route
`/agents/[agentId]`

## Purpose
Full management of a single agent: configuration, markdown files, and skills. This is the most complex page.

## Data Sources
- `GET /api/agents/{agentId}` → `AgentConfig`
- `GET /api/agents/{agentId}/files` → `AgentFile[]`
- `GET /api/agents/{agentId}/skills` → `SkillSummary[]`

## Structure
Three tabs: **Config**, **Files**, **Skills**

Page header shows: agent name, model badge, quick "Test in Chat" link → `/chat/{agentId}`.

---

## Tab: Config

Visual editor for `agent.yml` with a toggle to switch to raw YAML editing.

### Form Mode (default)

Organized in collapsible sections:

**General:**
- Model (select dropdown with common models)
- Timezone (text input, IANA format, e.g. "Europe/Moscow")
- Queue mode (select: collect, steer, interrupt)
  - Tooltip explaining each mode
- Session policy (select: never, hourly, daily, weekly)
- Auto-compress threshold (number input, 0 = disabled)

**Iteration Budget:**
- Tool call limit (number input, default 30)
- Timeout ms (number input, default 120000)

**Pairing / Access Control:**
- Mode (select: off, open, code, approve)
- Pairing code (text input, shown only when mode = "code")
- Note: "Detailed allowlists are managed in raw YAML mode"

**Routes:**
Table of route entries. Each row:
- Channel (select: telegram, whatsapp)
- Account (select: populated from connected accounts in config.yml)
- Scope (select: dm, group, any)
- Peers (text input, comma-separated IDs, or empty for "all")
- Topics (text input, comma-separated IDs, or empty for "all")
- Mention only (checkbox, only enabled when scope = group)
- Delete row button

"Add Route" button appends a new empty row.

**MCP Tools:**
- Multi-select or checkbox list of available tools
- Tools list comes from the agent's tool catalog

**Save button:** PUT `/api/agents/{agentId}` with the serialized config.
- Show diff preview before saving (optional enhancement)
- Toast on success/failure
- Gateway auto-reloads via ConfigWatcher (no manual restart needed)

### Raw YAML Mode
- Toggle switch: "Raw YAML"
- Full-page textarea/code editor with the raw agent.yml content
- Save button: validates YAML syntax before sending
- Syntax error: inline error message with line number

### Validation
- At least one route if agent is meant to be active
- Model must be a valid model string
- Timezone must be valid IANA
- tool_call_limit > 0
- timeout_ms > 0

---

## Tab: Files

File manager for the agent's markdown and other text files.

### File List
- `GET /api/agents/{agentId}/files` returns all files in the agent directory (excluding agent.yml, skills/)
- Display: filename, size, last modified
- Clicking a file opens it in the editor panel

### File Editor
- Monospace textarea for editing
- File name shown above
- Save button: PUT `/api/agents/{agentId}/files/{filename}`
- Unsaved changes indicator (dot or asterisk in tab/filename)
- Keyboard shortcut: Cmd/Ctrl+S to save

### Create File
- "New File" button
- Dialog: filename input (must end in .md)
- Creates file with empty content, opens in editor

### Delete File
- Delete button per file (not shown for CLAUDE.md — it's required)
- Confirmation dialog
- DELETE `/api/agents/{agentId}/files/{filename}`

### Special Files
- `CLAUDE.md` — shown with a badge "System Prompt". Cannot be deleted.
- `soul.md` — shown with a badge "Persona" if it exists
- Other .md files — no special treatment

### Edge Cases
- File save conflict: if file was modified externally (hot-reload), show warning "File was modified externally. Overwrite?"
- Large files: warn if > 50KB

---

## Tab: Skills

Manage agent's skills (installed in `agents/{agentId}/skills/`).

### Skills List
For each skill:
- **Name** — directory name
- **Description** — from SKILL.md frontmatter
- **Platforms** — badges (telegram, whatsapp, or "all")
- **Tags** — badges

Actions per skill:
- **View** — opens SKILL.md content in a read-only modal/panel
- **Delete** — confirmation dialog → DELETE `/api/agents/{agentId}/skills/{skillName}`

### Upload Skill
Button: "Upload Skill"
- Drag-and-drop zone + file picker
- Accepted formats: .zip, .tar.gz, .tgz, .skill
- Max size: 10MB
- Flow:
  1. Client uploads file to POST `/api/agents/{agentId}/skills/upload` (multipart/form-data)
  2. Backend extracts archive
  3. Validates: must contain SKILL.md at root or one level deep
  4. If skill name conflicts with existing: ask to overwrite
  5. On success: refresh list, show toast
  6. On validation error: show what's wrong ("No SKILL.md found in archive")

### Clone from Git
Button: "Clone from Git"
- Dialog:
  - Git URL (text input, required)
  - Branch/tag (text input, optional, default: main)
  - Skill name override (text input, optional — defaults to repo name)
- POST `/api/agents/{agentId}/skills/git` with `{ url, ref, name }`
- Show progress: "Cloning..." spinner
- On success: refresh list
- On error: show git error message

### Empty State
"No skills installed. Upload a skill or clone from Git." + both action buttons.
