export interface HeartbeatTask {
  name: string;
  interval: string;
  prompt: string;
  script?: string;
  skills?: string[];
  timeout_ms?: number;
}

export interface ParsedHeartbeatFile {
  tasks: HeartbeatTask[];
  context: string;
  invalidTasks: Array<{ name?: string; reason: string }>;
}

export function isHeartbeatContentEffectivelyEmpty(content: string | undefined | null): boolean {
  if (content === undefined || content === null) return false;
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^#+(\s|$)/.test(trimmed)) continue;
    if (/^[-*+]\s*(\[[\sXx]?\]\s*)?$/.test(trimmed)) continue;
    if (/^```[A-Za-z0-9_-]*$/.test(trimmed)) continue;
    return false;
  }
  return true;
}

export function parseHeartbeatFile(content: string): ParsedHeartbeatFile {
  const lines = content.split(/\r?\n/);
  const tasks: HeartbeatTask[] = [];
  const invalidTasks: Array<{ name?: string; reason: string }> = [];
  let inTasksBlock = false;
  let tasksStart = -1;
  let tasksEnd = -1;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!inTasksBlock) {
      if (trimmed === 'tasks:') {
        inTasksBlock = true;
        tasksStart = i;
        tasksEnd = i;
      }
      continue;
    }

    const isIndented = line.startsWith(' ') || line.startsWith('\t');
    const isTaskStart = trimmed.startsWith('- name:');
    const isKnownTaskField = trimmed.startsWith('interval:') || trimmed.startsWith('prompt:') || isTaskStart;
    if (trimmed && !isIndented && !isTaskStart && !isKnownTaskField) {
      inTasksBlock = false;
      continue;
    }

    tasksEnd = i;
    if (!isTaskStart) continue;

    const name = unquote(trimmed.replace('- name:', '').trim());
    let interval = '';
    let prompt = '';
    let script: string | undefined;
    let skills: string[] | undefined;
    let timeoutMs: number | undefined;

    for (let j = i + 1; j < lines.length; j += 1) {
      const nextLine = lines[j];
      const nextTrimmed = nextLine.trim();
      if (nextTrimmed.startsWith('- name:')) break;
      if (nextTrimmed && !nextLine.startsWith(' ') && !nextLine.startsWith('\t')) break;

      if (nextTrimmed.startsWith('interval:')) {
        interval = unquote(nextTrimmed.replace('interval:', '').trim());
      } else if (nextTrimmed.startsWith('prompt:')) {
        prompt = unquote(nextTrimmed.replace('prompt:', '').trim());
      } else if (nextTrimmed.startsWith('script:')) {
        script = unquote(nextTrimmed.replace('script:', '').trim());
      } else if (nextTrimmed.startsWith('skills:')) {
        skills = parseList(nextTrimmed.replace('skills:', '').trim());
      } else if (nextTrimmed.startsWith('timeout_ms:')) {
        timeoutMs = parsePositiveInteger(nextTrimmed.replace('timeout_ms:', '').trim());
      }
    }

    if (!name || !interval || !prompt) {
      invalidTasks.push({
        ...(name ? { name } : {}),
        reason: 'task requires name, interval, and prompt',
      });
      continue;
    }
    tasks.push({
      name,
      interval,
      prompt,
      ...(script ? { script } : {}),
      ...(skills && skills.length > 0 ? { skills } : {}),
      ...(timeoutMs ? { timeout_ms: timeoutMs } : {}),
    });
  }

  const contextLines = [...lines];
  if (tasksStart >= 0 && tasksEnd >= tasksStart) {
    contextLines.splice(tasksStart, tasksEnd - tasksStart + 1);
  }
  return {
    tasks,
    context: contextLines.join('\n').trim(),
    invalidTasks,
  };
}

function unquote(value: string): string {
  return value.replace(/^["']|["']$/g, '').trim();
}

function parseList(value: string): string[] {
  const unquoted = unquote(value);
  const inner = unquoted.startsWith('[') && unquoted.endsWith(']')
    ? unquoted.slice(1, -1)
    : unquoted;
  return inner
    .split(',')
    .map((item) => unquote(item.trim()))
    .filter(Boolean);
}

function parsePositiveInteger(value: string): number | undefined {
  const parsed = Number.parseInt(unquote(value), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}
