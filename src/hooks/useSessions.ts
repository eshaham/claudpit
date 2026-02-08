import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { useEffect, useState } from 'react';

import type { SessionIndex, SessionIndexEntry, SessionRow } from '~/types.js';
import {
  determineStatus,
  getActiveSessionIds,
  getLastMessageRole,
} from '~/utils/sessionStatus.js';

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

function countMessages(filePath: string): number {
  try {
    const content = readFileSync(filePath, 'utf-8').trimEnd();
    return content.split('\n').length;
  } catch {
    return 0;
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
  const activeIds = getActiveSessionIds();
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

      if (now - mtime.getTime() > STALE_THRESHOLD) continue;

      const indexEntry = indexData?.entries.get(sessionId);
      const lastRole = getLastMessageRole(filePath);
      const status = determineStatus(sessionId, activeIds, lastRole);
      const projectPath =
        indexEntry?.projectPath ??
        indexData?.projectPath ??
        deriveProjectPath(dir);
      const projectName = projectPath.split('/').pop() ?? projectPath;

      sessions.push({
        sessionId,
        projectPath,
        projectName,
        gitBranch: indexEntry?.gitBranch ?? 'N/A',
        status,
        lastActive: mtime,
        messageCount: indexEntry?.messageCount ?? countMessages(filePath),
      });
    }
  }

  sessions.sort((a, b) => b.lastActive.getTime() - a.lastActive.getTime());
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
