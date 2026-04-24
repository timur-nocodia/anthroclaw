import type { MemoryStore, SearchResult } from './store.js';
import { logger } from '../logger.js';

interface PrefetchEntry {
  results: SearchResult[];
  keywords: string[];
  timestamp: number;
}

const MAX_CACHE_AGE_MS = 5 * 60 * 1000;
const MAX_KEYWORDS = 5;

export class PrefetchCache {
  private cache = new Map<string, PrefetchEntry>();

  extractKeywords(text: string): string[] {
    const stopWords = new Set([
      'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
      'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
      'should', 'may', 'might', 'shall', 'can', 'need', 'dare', 'ought',
      'used', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from',
      'as', 'into', 'through', 'during', 'before', 'after', 'above', 'below',
      'and', 'but', 'or', 'nor', 'not', 'so', 'yet', 'both', 'either',
      'neither', 'each', 'every', 'all', 'any', 'few', 'more', 'most',
      'other', 'some', 'such', 'no', 'only', 'same', 'than', 'too', 'very',
      'just', 'because', 'this', 'that', 'these', 'those', 'i', 'you', 'he',
      'she', 'it', 'we', 'they', 'me', 'him', 'her', 'us', 'them', 'my',
      'your', 'его', 'ее', 'их', 'мы', 'вы', 'они', 'что', 'как', 'это',
      'не', 'но', 'да', 'на', 'по', 'для', 'за', 'из', 'при', 'без',
    ]);

    const words = text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 3 && !stopWords.has(w));

    const freq = new Map<string, number>();
    for (const w of words) {
      freq.set(w, (freq.get(w) ?? 0) + 1);
    }

    return [...freq.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_KEYWORDS)
      .map(([word]) => word);
  }

  async prefetch(
    sessionKey: string,
    responseText: string,
    store: MemoryStore,
    embedFn?: (text: string) => Promise<Float32Array>,
  ): Promise<void> {
    const keywords = this.extractKeywords(responseText);
    if (keywords.length === 0) return;

    const query = keywords.join(' ');
    try {
      const results = store.textSearch(query, 5);
      this.cache.set(sessionKey, {
        results,
        keywords,
        timestamp: Date.now(),
      });
      logger.debug({ sessionKey, keywords, resultCount: results.length }, 'Memory prefetch completed');
    } catch (err) {
      logger.debug({ err, sessionKey }, 'Memory prefetch failed');
    }
  }

  get(sessionKey: string, currentKeywords?: string[]): SearchResult[] | null {
    const entry = this.cache.get(sessionKey);
    if (!entry) return null;

    if (Date.now() - entry.timestamp > MAX_CACHE_AGE_MS) {
      this.cache.delete(sessionKey);
      return null;
    }

    // Check relevance: at least 1 keyword overlap with current message
    if (currentKeywords && currentKeywords.length > 0) {
      const overlap = currentKeywords.filter((k) => entry.keywords.includes(k));
      if (overlap.length === 0) {
        this.cache.delete(sessionKey);
        return null;
      }
    }

    return entry.results;
  }

  invalidate(sessionKey: string): void {
    this.cache.delete(sessionKey);
  }

  clear(): void {
    this.cache.clear();
  }
}
