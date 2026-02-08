import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { useEffect, useState } from 'react';

import type { SessionIndex, SessionRow } from '~/types.js';
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
    const indexPath = join(CLAUDE_DIR, dir, 'sessions-index.json');
    let index: SessionIndex;
    try {
      index = JSON.parse(readFileSync(indexPath, 'utf-8'));
    } catch {
      continue;
    }

    for (const entry of index.entries) {
      const modified = new Date(entry.modified);
      if (now - modified.getTime() > STALE_THRESHOLD) continue;

      const sessionPath = entry.fullPath;
      const lastRole = getLastMessageRole(sessionPath);
      const status = determineStatus(entry.sessionId, activeIds, lastRole);
      const projectName =
        entry.projectPath.split('/').pop() ?? entry.projectPath;

      sessions.push({
        sessionId: entry.sessionId,
        projectPath: entry.projectPath,
        projectName,
        gitBranch: entry.gitBranch ?? 'N/A',
        status,
        lastActive: modified,
        messageCount: entry.messageCount,
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
