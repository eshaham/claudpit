import { execSync } from 'node:child_process';
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  watch,
} from 'node:fs';
import { join } from 'node:path';
import { useEffect, useState } from 'react';

import type { SessionIndex, SessionIndexEntry, SessionRow } from '~/types.js';
import { determineStatus, getActiveSessionIds } from '~/utils/sessionStatus.js';

const CLAUDE_DIR = join(
  process.env.HOME ?? process.env.USERPROFILE ?? '',
  '.claude',
  'projects',
);
const RENDER_INTERVAL = 200;
const FULL_SCAN_INTERVAL = 5000;
const STALE_THRESHOLD = 24 * 60 * 60 * 1000;

let lastFullScanMs = 0;
let cachedActiveIds = new Set<string>();
let dirty = true;

interface CachedSession {
  filePath: string;
  sessionId: string;
  mtimeMs: number;
  row: SessionRow;
}

let cachedSessions: CachedSession[] = [];
const projectNameCache = new Map<string, string>();
const gitBranchCache = new Map<string, string>();
const indexCache = new Map<string, { mtimeMs: number; data: IndexData }>();
const metadataCache = new Map<
  string,
  { mtimeMs: number; meta: JsonlMetadata }
>();
const dirWatchers = new Map<string, ReturnType<typeof watch>>();

function markDirty() {
  dirty = true;
}

function watchDir(dirPath: string) {
  if (dirWatchers.has(dirPath)) return;
  try {
    const watcher = watch(dirPath, markDirty);
    watcher.on('error', () => {
      watcher.close();
      dirWatchers.delete(dirPath);
    });
    dirWatchers.set(dirPath, watcher);
  } catch {
    // ignore
  }
}

function closeAllWatchers() {
  for (const w of dirWatchers.values()) w.close();
  dirWatchers.clear();
}

function deriveProjectPath(dirName: string): string {
  return dirName.replace(/^-/, '/').replaceAll('-', '/');
}

interface JsonlMetadata {
  messageCount: number;
  gitBranch: string | undefined;
  cwd: string | undefined;
}

function parseJsonlMetadata(filePath: string, mtimeMs: number): JsonlMetadata {
  const cached = metadataCache.get(filePath);
  if (cached && cached.mtimeMs === mtimeMs) return cached.meta;

  let messageCount = 0;
  let gitBranch: string | undefined;
  let cwd: string | undefined;
  try {
    const content = readFileSync(filePath, 'utf-8').trimEnd();
    for (const line of content.split('\n')) {
      const parsed = JSON.parse(line);
      const type = parsed?.type;
      if (type === 'user' || type === 'assistant') {
        messageCount++;
      }
      if (type === 'user') {
        if (parsed.gitBranch) gitBranch = parsed.gitBranch;
        if (!cwd && parsed.cwd) cwd = parsed.cwd;
      }
    }
  } catch {
    // ignore
  }
  const meta = { messageCount, gitBranch, cwd };
  metadataCache.set(filePath, { mtimeMs, meta });
  return meta;
}

const MANIFEST_READERS: Array<{
  file: string;
  extract: (content: string) => string | undefined;
}> = [
  {
    file: 'package.json',
    extract: (c) => {
      try {
        return JSON.parse(c).name || undefined;
      } catch {
        return undefined;
      }
    },
  },
  {
    file: 'Cargo.toml',
    extract: (c) => c.match(/^\s*name\s*=\s*"([^"]+)"/m)?.[1],
  },
  {
    file: 'pyproject.toml',
    extract: (c) => c.match(/^\s*name\s*=\s*"([^"]+)"/m)?.[1],
  },
  {
    file: 'go.mod',
    extract: (c) => {
      const mod = c.match(/^module\s+(\S+)/m)?.[1];
      return mod?.split('/').pop();
    },
  },
  {
    file: 'settings.gradle',
    extract: (c) => c.match(/rootProject\.name\s*=\s*['"]([^'"]+)['"]/)?.[1],
  },
  {
    file: 'settings.gradle.kts',
    extract: (c) => c.match(/rootProject\.name\s*=\s*"([^"]+)"/)?.[1],
  },
];

function resolveProjectName(projectPath: string): string {
  const cached = projectNameCache.get(projectPath);
  if (cached !== undefined) return cached;

  for (const { file, extract } of MANIFEST_READERS) {
    const fp = join(projectPath, file);
    if (!existsSync(fp)) continue;
    try {
      const content = readFileSync(fp, 'utf-8');
      const name = extract(content);
      if (name) {
        projectNameCache.set(projectPath, name);
        return name;
      }
    } catch {
      continue;
    }
  }
  const fallback = projectPath.split('/').pop() ?? projectPath;
  projectNameCache.set(projectPath, fallback);
  return fallback;
}

function resolveGitBranch(projectPath: string): string | undefined {
  const cached = gitBranchCache.get(projectPath);
  if (cached !== undefined) return cached;

  try {
    const branch = execSync('git rev-parse --abbrev-ref HEAD', {
      cwd: projectPath,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    gitBranchCache.set(projectPath, branch);
    return branch;
  } catch {
    return undefined;
  }
}

interface IndexData {
  entries: Map<string, SessionIndexEntry>;
  projectPath: string | undefined;
}

function loadIndex(dirPath: string): IndexData | undefined {
  const indexPath = join(dirPath, 'sessions-index.json');
  try {
    const { mtimeMs } = statSync(indexPath);
    const cached = indexCache.get(dirPath);
    if (cached && cached.mtimeMs === mtimeMs) return cached.data;

    const index: SessionIndex = JSON.parse(readFileSync(indexPath, 'utf-8'));
    const entries = new Map<string, SessionIndexEntry>();
    for (const entry of index.entries) {
      entries.set(entry.sessionId, entry);
    }
    const projectPath = index.entries[0]?.projectPath;
    const data: IndexData = { entries, projectPath };
    indexCache.set(dirPath, { mtimeMs, data });
    return data;
  } catch {
    return undefined;
  }
}

const STATUS_PRIORITY = { running: 0, waiting: 1, idle: 2, inactive: 3 };

function sortRows(rows: SessionRow[]): SessionRow[] {
  return rows.sort(
    (a, b) =>
      STATUS_PRIORITY[a.status] - STATUS_PRIORITY[b.status] ||
      b.lastActive.getTime() - a.lastActive.getTime(),
  );
}

function fullScan(): SessionRow[] {
  const now = Date.now();
  lastFullScanMs = now;
  cachedActiveIds = getActiveSessionIds();
  gitBranchCache.clear();

  watchDir(CLAUDE_DIR);

  const sessions: CachedSession[] = [];
  const activeDirs = new Set<string>([CLAUDE_DIR]);

  let projectDirs: string[];
  try {
    projectDirs = readdirSync(CLAUDE_DIR);
  } catch {
    cachedSessions = [];
    return [];
  }

  for (const dir of projectDirs) {
    const dirPath = join(CLAUDE_DIR, dir);
    activeDirs.add(dirPath);
    watchDir(dirPath);
    const indexData = loadIndex(dirPath);

    let files: string[];
    try {
      files = readdirSync(dirPath).filter((f) => f.endsWith('.jsonl'));
    } catch {
      continue;
    }

    for (const file of files) {
      const sessionId = file.replace('.jsonl', '');
      const filePath = join(dirPath, file);

      let mtime: Date;
      let mtimeMs: number;
      try {
        const stat = statSync(filePath);
        mtime = stat.mtime;
        mtimeMs = stat.mtimeMs;
      } catch {
        continue;
      }

      const isActive = cachedActiveIds.has(sessionId);
      if (!isActive && now - mtime.getTime() > STALE_THRESHOLD) continue;

      const indexEntry = indexData?.entries.get(sessionId);
      const jsonlMeta = indexEntry
        ? undefined
        : parseJsonlMetadata(filePath, mtimeMs);
      const projectPath =
        indexEntry?.projectPath ??
        jsonlMeta?.cwd ??
        indexData?.projectPath ??
        deriveProjectPath(dir);
      const projectName = resolveProjectName(projectPath);
      const status = determineStatus(
        sessionId,
        cachedActiveIds,
        filePath,
        mtimeMs,
      );

      let gitBranch = indexEntry?.gitBranch ?? jsonlMeta?.gitBranch;
      if (!gitBranch || gitBranch === 'HEAD') {
        gitBranch = resolveGitBranch(projectPath) ?? gitBranch ?? 'N/A';
      }

      const row: SessionRow = {
        sessionId,
        projectPath,
        projectName,
        gitBranch,
        status,
        lastActive: mtime,
        messageCount: indexEntry?.messageCount ?? jsonlMeta?.messageCount ?? 0,
      };
      sessions.push({ filePath, sessionId, mtimeMs, row });
    }
  }

  for (const [path, watcher] of dirWatchers) {
    if (!activeDirs.has(path)) {
      watcher.close();
      dirWatchers.delete(path);
    }
  }

  cachedSessions = sessions;
  return sortRows(sessions.map((s) => s.row));
}

function quickScan(): SessionRow[] {
  for (const cached of cachedSessions) {
    try {
      const stat = statSync(cached.filePath);
      if (stat.mtimeMs !== cached.mtimeMs) {
        cached.mtimeMs = stat.mtimeMs;
        const status = determineStatus(
          cached.sessionId,
          cachedActiveIds,
          cached.filePath,
          stat.mtimeMs,
        );
        cached.row = { ...cached.row, lastActive: stat.mtime, status };
      }
    } catch {
      // ignore
    }
  }
  return sortRows(cachedSessions.map((s) => s.row));
}

function fetchSessions(): SessionRow[] {
  if (Date.now() - lastFullScanMs >= FULL_SCAN_INTERVAL) {
    return fullScan();
  }
  return quickScan();
}

export function useSessions(): SessionRow[] {
  const [sessions, setSessions] = useState<SessionRow[]>(() => {
    const result = fetchSessions();
    dirty = false;
    return result;
  });

  useEffect(() => {
    const interval = setInterval(() => {
      const needsFullScan = Date.now() - lastFullScanMs >= FULL_SCAN_INTERVAL;
      if (needsFullScan || dirty) {
        setSessions(fetchSessions());
        dirty = false;
      }
    }, RENDER_INTERVAL);

    return () => {
      clearInterval(interval);
      closeAllWatchers();
    };
  }, []);

  return sessions;
}
