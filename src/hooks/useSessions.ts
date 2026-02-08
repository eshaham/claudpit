import { execSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { useEffect, useState } from 'react';

import type { SessionIndex, SessionIndexEntry, SessionRow } from '~/types.js';
import { determineStatus, getActiveSessionIds } from '~/utils/sessionStatus.js';

const CLAUDE_DIR = join(
  process.env.HOME ?? process.env.USERPROFILE ?? '',
  '.claude',
  'projects',
);
const REFRESH_INTERVAL = 5000;
const STALE_THRESHOLD = 24 * 60 * 60 * 1000;

function deriveProjectPath(dirName: string): string {
  return dirName.replace(/^-/, '/').replaceAll('-', '/');
}

interface JsonlMetadata {
  messageCount: number;
  gitBranch: string | undefined;
  cwd: string | undefined;
}

function parseJsonlMetadata(filePath: string): JsonlMetadata {
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
  return { messageCount, gitBranch, cwd };
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
  for (const { file, extract } of MANIFEST_READERS) {
    const filePath = join(projectPath, file);
    if (!existsSync(filePath)) continue;
    try {
      const content = readFileSync(filePath, 'utf-8');
      const name = extract(content);
      if (name) return name;
    } catch {
      continue;
    }
  }
  return projectPath.split('/').pop() ?? projectPath;
}

function resolveGitBranch(projectPath: string): string | undefined {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', {
      cwd: projectPath,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
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
    const index: SessionIndex = JSON.parse(readFileSync(indexPath, 'utf-8'));
    const entries = new Map<string, SessionIndexEntry>();
    for (const entry of index.entries) {
      entries.set(entry.sessionId, entry);
    }
    const projectPath = index.entries[0]?.projectPath;
    return { entries, projectPath };
  } catch {
    return undefined;
  }
}

function fetchSessions(): SessionRow[] {
  const now = Date.now();
  const activeSessionIds = getActiveSessionIds();
  const sessions: SessionRow[] = [];

  let projectDirs: string[];
  try {
    projectDirs = readdirSync(CLAUDE_DIR);
  } catch {
    return [];
  }

  for (const dir of projectDirs) {
    const dirPath = join(CLAUDE_DIR, dir);
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
      try {
        mtime = statSync(filePath).mtime;
      } catch {
        continue;
      }

      const isActive = activeSessionIds.has(sessionId);
      if (!isActive && now - mtime.getTime() > STALE_THRESHOLD) continue;

      const indexEntry = indexData?.entries.get(sessionId);
      const jsonlMeta = indexEntry ? undefined : parseJsonlMetadata(filePath);
      const projectPath =
        indexEntry?.projectPath ??
        jsonlMeta?.cwd ??
        indexData?.projectPath ??
        deriveProjectPath(dir);
      const projectName = resolveProjectName(projectPath);
      const status = determineStatus(sessionId, activeSessionIds, filePath);

      let gitBranch = indexEntry?.gitBranch ?? jsonlMeta?.gitBranch;
      if (!gitBranch || gitBranch === 'HEAD') {
        gitBranch = resolveGitBranch(projectPath) ?? gitBranch ?? 'N/A';
      }

      sessions.push({
        sessionId,
        projectPath,
        projectName,
        gitBranch,
        status,
        lastActive: mtime,
        messageCount: indexEntry?.messageCount ?? jsonlMeta?.messageCount ?? 0,
      });
    }
  }

  const statusPriority = { running: 0, waiting: 1, idle: 2, inactive: 3 };
  sessions.sort(
    (a, b) =>
      statusPriority[a.status] - statusPriority[b.status] ||
      b.lastActive.getTime() - a.lastActive.getTime(),
  );
  return sessions;
}

export function useSessions(): SessionRow[] {
  const [sessions, setSessions] = useState<SessionRow[]>(() => fetchSessions());

  useEffect(() => {
    const interval = setInterval(() => {
      setSessions(fetchSessions());
    }, REFRESH_INTERVAL);
    return () => clearInterval(interval);
  }, []);

  return sessions;
}
