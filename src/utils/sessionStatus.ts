import { execFileSync, execSync } from 'node:child_process';
import {
  closeSync,
  fstatSync,
  openSync,
  readSync,
  readdirSync,
  statSync,
} from 'node:fs';
import { join } from 'node:path';

import type { SessionStatus } from '~/types.js';
import { CLAUDE_PROJECTS_DIR } from '~/utils/paths.js';

function getProcessStartEpoch(pid: string): number | undefined {
  try {
    const lstart = execFileSync('ps', ['-p', pid, '-o', 'lstart='], {
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
    const out = execFileSync('lsof', ['-a', '-p', pid, '-d', 'cwd', '-Fn'], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
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
  const dirPath = join(CLAUDE_PROJECTS_DIR, dirName);
  try {
    let bestId: string | undefined;
    let bestDiff = Infinity;
    for (const f of readdirSync(dirPath)) {
      if (!f.endsWith('.jsonl')) continue;
      const birthMs = statSync(join(dirPath, f)).birthtimeMs;
      const diff = birthMs - processStartMs;
      if (diff >= -5000 && diff <= 300000 && diff < bestDiff) {
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

const META_TYPES = new Set(['file-history-snapshot', 'system']);

const TAIL_BYTES = 8192;

function resolveActiveStatus(filePath: string): SessionStatus {
  try {
    const fd = openSync(filePath, 'r');
    try {
      const { size } = fstatSync(fd);
      const readStart = Math.max(0, size - TAIL_BYTES);
      const readLen = Math.min(TAIL_BYTES, size);
      if (readLen === 0) return 'running';
      const buf = Buffer.alloc(readLen);
      readSync(fd, buf, 0, readLen, readStart);
      let content = buf.toString('utf-8');
      if (readStart > 0) {
        const nl = content.indexOf('\n');
        if (nl !== -1) content = content.slice(nl + 1);
      }
      const lines = content.trimEnd().split('\n');
      for (let i = lines.length - 1; i >= 0; i--) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(lines[i]);
        } catch {
          continue;
        }
        const entry = parsed as {
          type?: string;
          message?: { content?: Array<{ type: string }> };
        };
        const type = entry?.type;
        if (!type || META_TYPES.has(type)) continue;
        if (
          type === 'progress' ||
          type === 'user' ||
          type === 'queue-operation'
        )
          return 'running';
        if (type !== 'assistant') return 'running';
        const contentItems = entry?.message?.content;
        if (!Array.isArray(contentItems)) return 'running';
        const hasToolUse = contentItems.some((c) => c.type === 'tool_use');
        if (hasToolUse) return 'waiting';
        const hasText = contentItems.some((c) => c.type === 'text');
        return hasText ? 'idle' : 'running';
      }
      return 'running';
    } finally {
      closeSync(fd);
    }
  } catch {
    return 'running';
  }
}

const RECENT_THRESHOLD = 3000;
const SUBAGENT_THRESHOLD = 60000;

function hasActiveSubagent(filePath: string): boolean {
  const subagentsDir = join(filePath.replace('.jsonl', ''), 'subagents');
  try {
    const now = Date.now();
    for (const f of readdirSync(subagentsDir)) {
      if (!f.endsWith('.jsonl')) continue;
      if (now - statSync(join(subagentsDir, f)).mtimeMs < SUBAGENT_THRESHOLD)
        return true;
    }
  } catch {
    return false;
  }
  return false;
}

export function determineStatus(
  sessionId: string,
  activeSessionIds: Set<string>,
  filePath: string,
  mtimeMs: number,
): SessionStatus {
  if (!activeSessionIds.has(sessionId)) return 'inactive';
  const status = resolveActiveStatus(filePath);
  if (status === 'idle' && Date.now() - mtimeMs < RECENT_THRESHOLD) {
    return 'running';
  }
  if (status === 'waiting') {
    if (Date.now() - mtimeMs < RECENT_THRESHOLD) return 'running';
    if (hasActiveSubagent(filePath)) return 'running';
  }
  return status;
}
