import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';

const DependencyStateSchema = z.enum(['ok', 'missing', 'error', 'unknown']);
const InstallStatusSchema = z.enum(['installed', 'missing', 'invalid', 'removed']);
const SourceTypeSchema = z.enum(['npm', 'local', 'git']);

export const PluginInstallRecordSchema = z.object({
  name: z.string().min(1),
  sourceType: SourceTypeSchema,
  sourceSpec: z.string().min(1),
  installRoot: z.string().min(1),
  installedVersion: z.string().min(1),
  manifestVersion: z.string().min(1),
  installedAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  dependencyState: DependencyStateSchema,
  status: InstallStatusSchema,
});

const PluginInstallStoreFileSchema = z.object({
  installs: z.record(z.string(), PluginInstallRecordSchema).default({}),
});

export type PluginInstallRecord = z.infer<typeof PluginInstallRecordSchema>;
export type PluginInstallSourceType = z.infer<typeof SourceTypeSchema>;
export type PluginInstallDependencyState = z.infer<typeof DependencyStateSchema>;
export type PluginInstallStatus = z.infer<typeof InstallStatusSchema>;

interface PluginInstallStoreFile {
  installs: Record<string, PluginInstallRecord>;
}

export class PluginInstallStore {
  private data: PluginInstallStoreFile = { installs: {} };

  constructor(private readonly filePath: string) {
    this.data = this.load();
  }

  list(): PluginInstallRecord[] {
    return Object.values(this.data.installs).sort((a, b) => a.name.localeCompare(b.name));
  }

  get(name: string): PluginInstallRecord | null {
    return this.data.installs[name] ?? null;
  }

  upsert(record: PluginInstallRecord): void {
    const parsed = PluginInstallRecordSchema.parse(record);
    this.data.installs[parsed.name] = parsed;
    this.save();
  }

  remove(name: string): boolean {
    if (!this.data.installs[name]) return false;
    delete this.data.installs[name];
    this.save();
    return true;
  }

  private load(): PluginInstallStoreFile {
    let raw: string;
    try {
      raw = readFileSync(this.filePath, 'utf-8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { installs: {} };
      throw err;
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(raw);
    } catch (err) {
      throw new Error(`plugin install store invalid JSON at ${this.filePath}: ${(err as Error).message}`);
    }

    const parsed = PluginInstallStoreFileSchema.safeParse(parsedJson);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
      throw new Error(`plugin install store schema violation at ${this.filePath}: ${issues}`);
    }
    return parsed.data;
  }

  private save(): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const tmpPath = `${this.filePath}.tmp-${process.pid}-${Date.now()}`;
    writeFileSync(tmpPath, `${JSON.stringify(this.data, null, 2)}\n`, 'utf-8');
    renameSync(tmpPath, this.filePath);
  }
}
