import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import {
  DirectoryNotEmptyError,
  DirectoryNotFoundError,
  FileExistsError,
  FileNotFoundError,
  IsDirectoryError,
  NotDirectoryError,
  StaleFileError,
  type CopyOptions,
  type FileContent,
  type FileEntry,
  type FilesystemInfo,
  type FileStat,
  type ListOptions,
  type ReadOptions,
  type RemoveOptions,
  type WorkspaceFilesystem,
  type WriteOptions,
} from '@mastra/core/workspace';
import { DefraDbClient, type WorkspaceEntry, type WorkspaceEntryInput } from './client';
import { isDescendantPath, normalizeWorkspacePath, workspacePathParts } from './path-utils';

export interface DefraDbFilesystemOptions {
  id?: string;
  baseUrl: string;
  graphqlPath?: string;
  nodeId: string;
  timeoutMs?: number;
  maxFileBytes?: number;
}

const MIME_TYPES: Record<string, string> = {
  '.css': 'text/css',
  '.csv': 'text/csv',
  '.html': 'text/html',
  '.json': 'application/json',
  '.jsonl': 'application/x-ndjson',
  '.md': 'text/markdown',
  '.mjs': 'text/javascript',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.yaml': 'application/yaml',
  '.yml': 'application/yaml',
};

function mimeTypeFor(path: string): string {
  return MIME_TYPES[posix.extname(path).toLowerCase()] ?? 'application/octet-stream';
}

function bufferFromContent(content: FileContent): Buffer {
  return typeof content === 'string' ? Buffer.from(content, 'utf8') : Buffer.from(content);
}

function bufferFromEntry(entry: WorkspaceEntry): Buffer {
  if (!entry.content) {
    return Buffer.alloc(0);
  }

  return Buffer.from(entry.content, entry.encoding === 'base64' ? 'base64' : 'utf8');
}

function toStat(entry: WorkspaceEntry): FileStat {
  return {
    name: entry.name,
    path: entry.path,
    type: entry.entryType,
    size: entry.size,
    createdAt: new Date(entry.createdAt),
    modifiedAt: new Date(entry.modifiedAt),
    mimeType: entry.mimeType ?? undefined,
  };
}

export class DefraDbFilesystem implements WorkspaceFilesystem {
  readonly id: string;
  readonly name = 'DefraDbFilesystem';
  readonly provider = 'defradb';
  readonly icon = 'database';
  readonly displayName = 'DefraDB Workspace';
  readonly description = 'A Mastra workspace stored in and synchronized by DefraDB.';
  status: WorkspaceFilesystem['status'] = 'pending';
  error?: string;

  private readonly client: DefraDbClient;
  private readonly nodeId: string;
  private readonly maxFileBytes: number;
  private initPromise?: Promise<void>;
  private readonly writeQueues = new Map<string, Promise<void>>();

  constructor(options: DefraDbFilesystemOptions) {
    this.id = options.id ?? 'defradb-filesystem';
    this.nodeId = options.nodeId;
    this.maxFileBytes = options.maxFileBytes ?? 10 * 1024 * 1024;
    this.client = new DefraDbClient({
      baseUrl: options.baseUrl,
      graphqlPath: options.graphqlPath,
      timeoutMs: options.timeoutMs,
    });
  }

  async init(): Promise<void> {
    this.initPromise ??= this.initializeWithStatus();
    return this.initPromise;
  }

  async destroy(): Promise<void> {
    this.status = 'destroying';
    this.initPromise = undefined;
    this.status = 'destroyed';
  }

  async getInfo(): Promise<FilesystemInfo> {
    return {
      id: this.id,
      name: this.name,
      provider: this.provider,
      status: this.status,
      error: this.error,
      icon: this.icon,
      metadata: {
        endpoint: this.client.endpoint,
        nodeId: this.nodeId,
        maxFileBytes: this.maxFileBytes,
      },
    };
  }

  getInstructions(): string {
    return 'Files are stored in the shared DefraDB workspace. Paths are POSIX-style and relative to the workspace root. Changes may synchronize with peer DefraDB nodes.';
  }

  async readFile(pathInput: string, options?: ReadOptions): Promise<string | Buffer> {
    await this.ensureReady();
    const path = normalizeWorkspacePath(pathInput);
    const entry = await this.client.getEntry(path);

    if (!entry) throw new FileNotFoundError(path);
    if (entry.entryType === 'directory') throw new IsDirectoryError(path);

    const buffer = bufferFromEntry(entry);
    return options?.encoding ? buffer.toString(options.encoding) : buffer;
  }

  async writeFile(pathInput: string, content: FileContent, options?: WriteOptions): Promise<void> {
    const path = normalizeWorkspacePath(pathInput);
    await this.withWriteLock(path, async () => {
      await this.ensureReady();
      const buffer = bufferFromContent(content);

      if (buffer.byteLength > this.maxFileBytes) {
        throw new Error(`Workspace file ${path} is ${buffer.byteLength} bytes; limit is ${this.maxFileBytes}`);
      }

      const existing = await this.client.getEntry(path, true);
      if (existing && !existing.deleted && existing.entryType === 'directory') throw new IsDirectoryError(path);
      if (existing && !existing.deleted && options?.overwrite === false) throw new FileExistsError(path);
      if (existing && !existing.deleted && options?.expectedMtime) {
        const actualMtime = new Date(existing.modifiedAt);
        if (actualMtime.getTime() !== options.expectedMtime.getTime()) {
          throw new StaleFileError(path, options.expectedMtime, actualMtime);
        }
      }

      const { parentPath, name } = workspacePathParts(path);
      const parent = await this.client.getEntry(parentPath);
      if (!parent) {
        if (!options?.recursive) throw new DirectoryNotFoundError(parentPath);
        await this.mkdir(parentPath, { recursive: true });
      } else if (parent.entryType !== 'directory') {
        throw new NotDirectoryError(parentPath);
      }

      const now = new Date().toISOString();
      const encoding = typeof content === 'string' ? 'utf-8' : 'base64';
      const input: WorkspaceEntryInput = {
        path,
        parentPath,
        name,
        entryType: 'file',
        content: encoding === 'utf-8' ? buffer.toString('utf8') : buffer.toString('base64'),
        encoding,
        mimeType: options?.mimeType ?? mimeTypeFor(path),
        size: buffer.byteLength,
        contentHash: createHash('sha256').update(buffer).digest('hex'),
        createdAt: existing?.createdAt ?? now,
        modifiedAt: now,
        revision: (existing?.revision ?? 0) + 1,
        deleted: false,
        writerNodeId: this.nodeId,
      };

      await this.upsert(existing, input);
    });
  }

  async appendFile(pathInput: string, content: FileContent): Promise<void> {
    const path = normalizeWorkspacePath(pathInput);
    await this.ensureReady();
    const existing = await this.client.getEntry(path);
    if (!existing) {
      await this.writeFile(path, content, { recursive: true });
      return;
    }
    if (existing.entryType === 'directory') throw new IsDirectoryError(path);

    await this.writeFile(path, Buffer.concat([bufferFromEntry(existing), bufferFromContent(content)]), {
      recursive: true,
      expectedMtime: new Date(existing.modifiedAt),
    });
  }

  async deleteFile(pathInput: string, options?: RemoveOptions): Promise<void> {
    const path = normalizeWorkspacePath(pathInput);
    await this.withWriteLock(path, async () => {
      await this.ensureReady();
      const entry = await this.client.getEntry(path);
      if (!entry) {
        if (options?.force) return;
        throw new FileNotFoundError(path);
      }
      if (entry.entryType === 'directory') throw new IsDirectoryError(path);
      await this.softDelete(entry);
    });
  }

  async copyFile(srcInput: string, destInput: string, options?: CopyOptions): Promise<void> {
    await this.ensureReady();
    const src = normalizeWorkspacePath(srcInput);
    const dest = normalizeWorkspacePath(destInput);
    const source = await this.client.getEntry(src);
    if (!source) throw new FileNotFoundError(src);

    if (source.entryType === 'directory') {
      if (!options?.recursive) throw new IsDirectoryError(src);
      await this.mkdir(dest, { recursive: true });
      const entries = (await this.client.listEntries()).filter(entry => isDescendantPath(entry.path, src));
      for (const entry of entries.sort((a, b) => a.path.length - b.path.length)) {
        const target = `${dest}${entry.path.slice(src.length)}`;
        if (entry.entryType === 'directory') await this.mkdir(target, { recursive: true });
        else await this.writeFile(target, bufferFromEntry(entry), { recursive: true, overwrite: options.overwrite });
      }
      return;
    }

    await this.writeFile(dest, bufferFromEntry(source), {
      recursive: true,
      overwrite: options?.overwrite,
      mimeType: source.mimeType ?? undefined,
    });
  }

  async moveFile(src: string, dest: string, options?: CopyOptions): Promise<void> {
    const source = await this.stat(src);
    await this.copyFile(src, dest, { ...options, recursive: source.type === 'directory' || options?.recursive });
    if (source.type === 'directory') await this.rmdir(src, { recursive: true });
    else await this.deleteFile(src);
  }

  async mkdir(pathInput: string, options?: { recursive?: boolean }): Promise<void> {
    await this.ensureReady();
    const path = normalizeWorkspacePath(pathInput);
    if (path === '/') return;

    const existing = await this.client.getEntry(path, true);
    if (existing && !existing.deleted) {
      if (existing.entryType === 'file') throw new FileExistsError(path);
      return;
    }

    const { parentPath, name } = workspacePathParts(path);
    const parent = await this.client.getEntry(parentPath);
    if (!parent) {
      if (!options?.recursive) throw new DirectoryNotFoundError(parentPath);
      await this.mkdir(parentPath, { recursive: true });
    } else if (parent.entryType !== 'directory') {
      throw new NotDirectoryError(parentPath);
    }

    const now = new Date().toISOString();
    await this.upsert(existing, {
      path,
      parentPath,
      name,
      entryType: 'directory',
      content: null,
      encoding: null,
      mimeType: null,
      size: 0,
      contentHash: null,
      createdAt: existing?.createdAt ?? now,
      modifiedAt: now,
      revision: (existing?.revision ?? 0) + 1,
      deleted: false,
      writerNodeId: this.nodeId,
    });
  }

  async rmdir(pathInput: string, options?: RemoveOptions): Promise<void> {
    await this.ensureReady();
    const path = normalizeWorkspacePath(pathInput);
    if (path === '/') throw new DirectoryNotEmptyError(path);
    const entry = await this.client.getEntry(path);
    if (!entry) {
      if (options?.force) return;
      throw new DirectoryNotFoundError(path);
    }
    if (entry.entryType !== 'directory') throw new NotDirectoryError(path);

    const descendants = (await this.client.listEntries()).filter(item => isDescendantPath(item.path, path));
    if (descendants.length && !options?.recursive) throw new DirectoryNotEmptyError(path);
    for (const child of descendants.sort((a, b) => b.path.length - a.path.length)) await this.softDelete(child);
    await this.softDelete(entry);
  }

  async readdir(pathInput: string, options?: ListOptions): Promise<FileEntry[]> {
    await this.ensureReady();
    const path = normalizeWorkspacePath(pathInput);
    const directory = await this.client.getEntry(path);
    if (!directory) throw new DirectoryNotFoundError(path);
    if (directory.entryType !== 'directory') throw new NotDirectoryError(path);

    const extensions = options?.extension
      ? new Set((Array.isArray(options.extension) ? options.extension : [options.extension]).map(item => item.toLowerCase()))
      : undefined;
    const directoryDepth = path === '/' ? 0 : path.split('/').length - 1;

    return (await this.client.listEntries())
      .filter(entry => {
        if (entry.path === path) return false;
        if (options?.recursive) {
          if (!isDescendantPath(entry.path, path)) return false;
          const depth = entry.path.split('/').length - 1 - directoryDepth;
          if (options.maxDepth !== undefined && depth > options.maxDepth) return false;
        } else if (entry.parentPath !== path) {
          return false;
        }
        return !extensions || entry.entryType === 'directory' || extensions.has(posix.extname(entry.name).toLowerCase());
      })
      .map(entry => ({ name: options?.recursive ? entry.path.slice(path === '/' ? 1 : path.length + 1) : entry.name, type: entry.entryType, size: entry.size }));
  }

  async exists(path: string): Promise<boolean> {
    await this.ensureReady();
    return Boolean(await this.client.getEntry(normalizeWorkspacePath(path)));
  }

  async stat(pathInput: string): Promise<FileStat> {
    await this.ensureReady();
    const path = normalizeWorkspacePath(pathInput);
    const entry = await this.client.getEntry(path);
    if (!entry) throw new FileNotFoundError(path);
    return toStat(entry);
  }

  private async initialize(): Promise<void> {
    await this.client.healthCheck();
    const root = await this.client.getEntry('/', true);
    if (root && !root.deleted) return;
    const now = new Date().toISOString();
    await this.upsert(root, {
      path: '/', parentPath: '/', name: '', entryType: 'directory', content: null, encoding: null,
      mimeType: null, size: 0, contentHash: null, createdAt: root?.createdAt ?? now, modifiedAt: now,
      revision: (root?.revision ?? 0) + 1, deleted: false, writerNodeId: this.nodeId,
    });
  }

  private async initializeWithStatus(): Promise<void> {
    this.status = 'initializing';
    this.error = undefined;
    try {
      await this.initialize();
      this.status = 'ready';
    } catch (error) {
      this.status = 'error';
      this.error = error instanceof Error ? error.message : String(error);
      this.initPromise = undefined;
      throw error;
    }
  }

  private async ensureReady(): Promise<void> {
    await this.init();
  }

  private async upsert(existing: WorkspaceEntry | undefined, input: WorkspaceEntryInput): Promise<void> {
    if (existing) {
      await this.client.updateEntry(existing._docID, input);
      return;
    }
    try {
      await this.client.createEntry(input);
    } catch (error) {
      const concurrent = await this.client.getEntry(input.path, true);
      if (!concurrent) throw error;
      await this.client.updateEntry(concurrent._docID, { ...input, revision: concurrent.revision + 1 });
    }
  }

  private async softDelete(entry: WorkspaceEntry): Promise<void> {
    await this.client.updateEntry(entry._docID, {
      deleted: true,
      modifiedAt: new Date().toISOString(),
      revision: entry.revision + 1,
      writerNodeId: this.nodeId,
    });
  }

  private async withWriteLock(path: string, operation: () => Promise<void>): Promise<void> {
    const previous = this.writeQueues.get(path) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(operation);
    this.writeQueues.set(path, current);
    try {
      await current;
    } finally {
      if (this.writeQueues.get(path) === current) this.writeQueues.delete(path);
    }
  }
}
