# Page: Chat

## Route
`/chat/[agentId]`

## Purpose
Live testing of an agent through a real Claude Agent SDK conversation. Sends messages through the Gateway as if coming from a "web" channel.

## Data Sources
- POST `/api/agents/{agentId}/chat` (SSE stream) — send message, receive streaming response
- DELETE `/api/agents/{agentId}/chat/{sessionId}` — reset session
- `GET /api/agents` — for agent selector

## Agent Selection
- If `agentId` is in the URL, that agent is selected
- Agent selector (dropdown or similar) at the top to switch between agents
- Changing agent navigates to `/chat/{newAgentId}` and starts a fresh session

## Chat Behavior

### Sending a Message
1. User types in input field, presses Enter or clicks Send
2. Message appears immediately in the conversation as a user bubble
3. POST `/api/agents/{agentId}/chat` with `{ message, sessionId }` — returns SSE stream
4. Input is disabled during agent response (or allow queuing next message)
5. Send button shows a stop/cancel icon during streaming

### Streaming Response
SSE events are processed in order:

- `{ type: 'text', chunk }` — append text to the current agent message. Render progressively.
- `{ type: 'tool_call', name, input }` — show a tool call card inline in the conversation:
  - Tool name as header
  - Input parameters displayed as key-value pairs or JSON
  - Card is initially expanded, collapsible
  - Visual indicator: "running..." while waiting for result
- `{ type: 'tool_result', name, output }` — update the corresponding tool card:
  - Show output (truncated if long, expandable)
  - Change indicator from "running" to "done"
- `{ type: 'done', sessionId, totalTokens }` — response complete
  - Re-enable input
  - Store sessionId for subsequent messages
  - Show token count as subtle metadata below the message
- `{ type: 'error', message }` — show error inline in conversation as a red error card

### Message Rendering
- **User messages:** plain text, right-aligned or visually distinct
- **Agent messages:** rendered as Markdown (use `react-markdown` or similar)
  - Code blocks with syntax highlighting
  - Links are clickable
  - Images rendered inline (if agent sends image URLs)
- **Tool calls:** collapsible cards between text segments

### Session Management
- Session ID is maintained in component state (not URL)
- "New Session" button in header — resets conversation:
  - DELETE `/api/agents/{agentId}/chat/{sessionId}`
  - Clears conversation history in UI
  - Resets sessionId to null
- Session persists as long as the page is open (not across page reloads)

### Channel Context Emulation
Settings gear icon or dropdown in the header:
- **Channel** (select): web (default), telegram, whatsapp
- **Chat type** (select): dm (default), group
- These are sent with each message to set routing context, so the agent sees appropriate skills and behaves as if in that channel

## Conversation Display

### Auto-scroll
- Scroll to bottom on new content (text chunk, tool call)
- If user scrolls up: stop auto-scrolling
- Show "Jump to bottom" floating button when scrolled up
- Resume auto-scroll when user clicks the button or scrolls to bottom manually

### Conversation History
- Stored in React state only (not persisted)
- Cleared on New Session or page navigation
- Each message has: role (user/agent), content (text + tool calls), timestamp

## Input Area
- Multi-line text input (textarea that grows, max ~5 lines, then scrolls)
- Enter sends, Shift+Enter for new line
- Disabled while agent is responding (show "Agent is thinking..." placeholder)
- Character count or token estimate (optional, low priority)

## Header
- Agent name + model badge
- "New Session" button
- Channel context selector
- Token usage for current session (cumulative from 'done' events)

## Empty State
When no messages yet: centered message "Send a message to start testing {agentName}" with a few suggested prompts as clickable chips (e.g. "Tell me about yourself", "What tools do you have?", "List your skills").

## Error Handling
- SSE connection lost: show reconnection banner, retry automatically
- Agent error (SDK error): show inline error card with message, "Retry" button
- Network error: toast + retry option
