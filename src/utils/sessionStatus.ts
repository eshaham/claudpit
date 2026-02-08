import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import type { SessionStatus } from '~/types.js';

export function getActiveSessionIds(): Set<string> {
  try {
    const output = execSync("ps aux | grep claude | grep '\\-\\-resume'", {
      encoding: 'utf-8',
    });
    const ids = new Set<string>();
    for (const line of output.split('\n')) {
      const match = line.match(/--resume\s+(\S+)/);
      if (match) {
        ids.add(match[1]);
      }
    }
    return ids;
  } catch {
    return new Set();
  }
}

export function getLastMessageRole(
  sessionPath: string,
): 'user' | 'assistant' | null {
  try {
    const content = readFileSync(sessionPath, 'utf-8').trimEnd();
    const lastLine = content.split('\n').pop();
    if (!lastLine) return null;
    const parsed = JSON.parse(lastLine);
    return parsed?.message?.role ?? null;
  } catch {
    return null;
  }
}

export function determineStatus(
  sessionId: string,
  activeIds: Set<string>,
  lastMessageRole: 'user' | 'assistant' | null,
): SessionStatus {
  if (lastMessageRole === 'assistant') {
    return 'waiting';
  }
  if (lastMessageRole === 'user' && activeIds.has(sessionId)) {
    return 'running';
  }
  return 'stale';
}
