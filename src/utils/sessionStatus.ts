import { execSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import type { SessionStatus } from '~/types.js';

const CLAUDE_DIR = join(
  process.env.HOME ?? process.env.USERPROFILE ?? '',
  '.claude',
  'projects',
);

function getProcessStartEpoch(pid: string): number | undefined {
  try {
    const lstart = execSync(`ps -p ${pid} -o lstart=`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    const ms = Date.parse(lstart);
    return Number.isNaN(ms) ? undefined : ms;
  } catch {
    return undefined;
  }
}

function getProcessCwd(pid: string): string | undefined {
  try {
    const out = execSync(`lsof -a -p ${pid} -d cwd -Fn 2>/dev/null`, {
      encoding: 'utf-8',
    });
    return out.match(/n(.+)/)?.[1];
  } catch {
    return undefined;
  }
}

function matchSessionByBirthTime(
  cwd: string,
  processStartMs: number,
): string | undefined {
  const dirName = '-' + cwd.slice(1).replaceAll('/', '-');
  const dirPath = join(CLAUDE_DIR, dirName);
  try {
    let bestId: string | undefined;
    let bestDiff = Infinity;
    for (const f of readdirSync(dirPath)) {
      if (!f.endsWith('.jsonl')) continue;
      const birthMs = statSync(join(dirPath, f)).birthtimeMs;
      const diff = birthMs - processStartMs;
      if (diff >= -5000 && diff < bestDiff) {
        bestDiff = diff;
        bestId = f.replace('.jsonl', '');
      }
    }
    return bestId;
  } catch {
    return undefined;
  }
}

export function getActiveSessionIds(): Set<string> {
  const sessionIds = new Set<string>();
  try {
    const output = execSync(
      "ps aux | grep 'native-binary/claude' | grep -v grep",
      { encoding: 'utf-8' },
    );
    const pidsWithoutResume: string[] = [];
    for (const line of output.split('\n')) {
      const resumeMatch = line.match(/--resume\s+(\S+)/);
      if (resumeMatch) {
        sessionIds.add(resumeMatch[1]);
      } else {
        const pidMatch = line.match(/\S+\s+(\d+)/);
        if (pidMatch) pidsWithoutResume.push(pidMatch[1]);
      }
    }
    for (const pid of pidsWithoutResume) {
      const cwd = getProcessCwd(pid);
      if (!cwd) continue;
      const startMs = getProcessStartEpoch(pid);
      if (!startMs) continue;
      const sessionId = matchSessionByBirthTime(cwd, startMs);
      if (sessionId) sessionIds.add(sessionId);
    }
  } catch {
    // ignore
  }
  return sessionIds;
}

const META_TYPES = new Set([
  'queue-operation',
  'file-history-snapshot',
  'system',
]);

function resolveActiveStatus(filePath: string): SessionStatus {
  try {
    const content = readFileSync(filePath, 'utf-8').trimEnd();
    const lines = content.split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      const parsed = JSON.parse(lines[i]);
      const type = parsed?.type;
      if (META_TYPES.has(type)) continue;
      if (type === 'progress' || type === 'user') return 'running';
      if (type !== 'assistant') return 'running';
      const contentItems = parsed?.message?.content;
      if (!Array.isArray(contentItems)) return 'running';
      const hasToolUse = contentItems.some(
        (c: { type: string }) => c.type === 'tool_use',
      );
      if (hasToolUse) return 'waiting';
      const hasText = contentItems.some(
        (c: { type: string }) => c.type === 'text',
      );
      return hasText ? 'idle' : 'running';
    }
    return 'running';
  } catch {
    return 'running';
  }
}

export function determineStatus(
  sessionId: string,
  activeSessionIds: Set<string>,
  filePath: string,
): SessionStatus {
  if (!activeSessionIds.has(sessionId)) return 'inactive';
  return resolveActiveStatus(filePath);
}
