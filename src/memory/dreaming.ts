import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { logger } from '../logger.js';
import type { MemoryProvider } from './provider.js';

export interface DreamingOptions {
  /** Days older than this threshold get consolidated (default: 7) */
  ageThresholdDays: number;
  /** Max tokens in a single dream summary (default: 2000 chars) */
  maxSummaryChars: number;
}

const DEFAULT_OPTIONS: DreamingOptions = {
  ageThresholdDays: 7,
  maxSummaryChars: 2000,
};

/**
 * Scan the memory/YYYY/MM/ daily files and consolidate old ones
 * into monthly summaries at memory/summaries/YYYY-MM.md.
 *
 * Uses the provided summarize function (typically a Claude API call)
 * to compress daily entries into a summary.
 */
export async function runDreaming(
  workspacePath: string,
  store: MemoryProvider,
  summarize: (text: string) => Promise<string>,
  opts?: Partial<DreamingOptions>,
): Promise<{ consolidated: string[]; summariesWritten: string[] }> {
  const options = { ...DEFAULT_OPTIONS, ...opts };
  const memoryDir = join(workspacePath, 'memory');

  if (!existsSync(memoryDir)) {
    return { consolidated: [], summariesWritten: [] };
  }

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - options.ageThresholdDays);
  const cutoffStr = formatDate(cutoff);

  // Find all daily memory files
  const dailyFiles = findDailyFiles(memoryDir);
  const eligibleFiles = dailyFiles.filter((f) => f.date < cutoffStr);

  if (eligibleFiles.length === 0) {
    logger.debug('Dreaming: no files old enough to consolidate');
    return { consolidated: [], summariesWritten: [] };
  }

  // Group by month
  const byMonth = new Map<string, typeof eligibleFiles>();
  for (const f of eligibleFiles) {
    const month = f.date.slice(0, 7); // YYYY-MM
    const existing = byMonth.get(month) ?? [];
    existing.push(f);
    byMonth.set(month, existing);
  }

  const summariesDir = join(memoryDir, 'summaries');
  mkdirSync(summariesDir, { recursive: true });

  const consolidated: string[] = [];
  const summariesWritten: string[] = [];

  for (const [month, files] of byMonth) {
    const summaryPath = join(summariesDir, `${month}.md`);

    // Skip if already summarized
    if (existsSync(summaryPath)) {
      logger.debug({ month }, 'Dreaming: monthly summary already exists, skipping');
      continue;
    }

    // Read and combine all daily files for this month
    const combined = files
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((f) => {
        const content = readFileSync(f.path, 'utf-8');
        return `--- ${f.date} ---\n${content}`;
      })
      .join('\n\n');

    if (combined.trim().length === 0) continue;

    try {
      const summary = await summarize(combined);

      const summaryContent = `# Memory Summary: ${month}\n\n_Auto-consolidated from ${files.length} daily entries._\n\n${summary}`;

      writeFileSync(summaryPath, summaryContent, 'utf-8');

      // Index the summary
      const relPath = `memory/summaries/${month}.md`;
      store.indexFile(relPath, summaryContent, {
        source: 'dreaming',
        reviewStatus: 'approved',
        metadata: {
          month,
          filesConsolidated: files.length,
        },
      });

      summariesWritten.push(relPath);
      consolidated.push(...files.map((f) => f.path));

      logger.info({ month, filesConsolidated: files.length }, 'Dreaming: monthly summary created');
    } catch (err) {
      logger.error({ err, month }, 'Dreaming: summarization failed');
    }
  }

  return { consolidated, summariesWritten };
}

interface DailyFile {
  path: string;
  date: string; // YYYY-MM-DD
}

function findDailyFiles(memoryDir: string): DailyFile[] {
  const results: DailyFile[] = [];

  // Scan memory/YYYY/MM/YYYY-MM-DD.md pattern
  const yearDirs = safeDirEntries(memoryDir).filter((e) => /^\d{4}$/.test(e));

  for (const year of yearDirs) {
    const yearPath = join(memoryDir, year);
    const monthDirs = safeDirEntries(yearPath).filter((e) => /^\d{2}$/.test(e));

    for (const month of monthDirs) {
      const monthPath = join(yearPath, month);
      const files = safeDirEntries(monthPath).filter((e) => /^\d{4}-\d{2}-\d{2}\.md$/.test(e));

      for (const file of files) {
        const date = basename(file, '.md');
        results.push({ path: join(monthPath, file), date });
      }
    }
  }

  return results;
}

function safeDirEntries(dirPath: string): string[] {
  try {
    return readdirSync(dirPath);
  } catch {
    return [];
  }
}

function formatDate(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}
