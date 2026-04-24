# Shared Components

These are custom components (beyond shadcn primitives) needed across multiple pages.

## StatusIndicator
- Props: `status: 'connected' | 'disconnected' | 'error' | 'reconnecting'`
- Renders: colored dot + label
- Colors: green, muted, red, yellow (pulsing)
- Used in: sidebar, dashboard, channels page

## SSEStream Hook
- `useSSE(url, options?)` — custom React hook
- Returns: `{ data: T[], isConnected, error, close }`
- Features:
  - Auto-reconnect with exponential backoff (1s, 2s, 4s, max 30s)
  - Parses `data:` lines as JSON
  - Buffers events if component is paused
  - Cleanup on unmount
- Used in: chat, logs, WhatsApp pairing

## CodeEditor
- Wrapper around a `<textarea>` with monospace styling
- Props: `value, onChange, language?, readonly?, placeholder?`
- Features:
  - Tab key inserts 2 spaces (not focus change)
  - Line numbers (CSS-based, not actual DOM elements)
  - Ctrl/Cmd+S triggers onSave callback
  - Minimal — NOT a full Monaco/CodeMirror. Just a styled textarea.
- Used in: agent files editor, raw YAML mode, skill viewer (readonly)

## ConfirmDialog
- Wraps shadcn AlertDialog
- Props: `title, description, confirmLabel, variant: 'default' | 'destructive', onConfirm`
- Used everywhere destructive actions happen

## EmptyState
- Props: `icon?, title, description, action?: { label, onClick }`
- Centered content block for empty lists
- Used in: agents list, skills list, channels, logs

## LogLine
- Props: `entry: LogEntry`
- Renders a single log line in terminal style
- Monospace, fixed height, colored level badge
- Expandable data section on click
- Used in: logs page, dashboard recent activity

## QRCode
- Props: `value: string, size?: number`
- Renders QR code using `qrcode.react` or `qrcode` library
- Dark theme compatible (light QR on dark background, or inverted)
- Used in: WhatsApp pairing

## ChatMessage
- Props: `role: 'user' | 'agent', content: string, toolCalls?: ToolCall[], tokens?: number, timestamp: Date`
- User message: plain text display
- Agent message: Markdown rendered (`react-markdown` with `rehype-highlight` for code)
- Tool calls rendered as collapsible cards inline
- Used in: chat page

## ToolCallCard
- Props: `name: string, input: object, output?: string, status: 'running' | 'done' | 'error'`
- Collapsible card showing tool name, input params, output
- Running state: pulsing indicator
- Input/output: formatted JSON or key-value display
- Used in: ChatMessage

## FileUploadZone
- Props: `accept: string[], maxSize: number, onUpload: (file: File) => void`
- Drag-and-drop zone with dashed border
- Click to open file picker
- Shows file name + size after selection
- Validation: file type, max size
- Used in: skills upload

## PageHeader
- Props: `title, description?, actions?: ReactNode`
- Consistent page title treatment with optional action buttons
- Used on every page
