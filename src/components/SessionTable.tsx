import { formatDistanceToNow } from 'date-fns';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import React from 'react';

import type { SessionRow } from '~/types.js';

interface SessionTableProps {
  sessions: SessionRow[];
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + '...';
}

function getColumnWidths() {
  const termWidth = process.stdout.columns || 80;
  return {
    project: Math.max(15, Math.floor(termWidth * 0.25)),
    branch: Math.max(15, Math.floor(termWidth * 0.25)),
    status: 12,
    activity: Math.max(12, Math.floor(termWidth * 0.2)),
    messages: 10,
  };
}

const STATUS_CONFIG = {
  running: { icon: '\u{1F7E2}', label: 'Running' },
  waiting: { icon: '\u{1F7E1}', label: 'Waiting' },
  idle: { icon: '\u{1F535}', label: 'Idle' },
  inactive: { icon: '\u{1F534}', label: 'Inactive' },
} as const;

function StatusCell({ status }: { status: SessionRow['status'] }) {
  const { icon, label } = STATUS_CONFIG[status];
  return (
    <Text>
      {icon} {label}
    </Text>
  );
}

function ActivityCell({
  status,
  lastActive,
  maxLen,
}: {
  status: SessionRow['status'];
  lastActive: Date;
  maxLen: number;
}) {
  if (status === 'running') {
    return (
      <Text>
        <Spinner type="dots" /> processing
      </Text>
    );
  }
  const text = formatDistanceToNow(lastActive) + ' ago';
  return <Text>{truncate(text, maxLen)}</Text>;
}

function pad(str: string, width: number): string {
  return str.padEnd(width);
}

export function SessionTable({ sessions }: SessionTableProps) {
  if (sessions.length === 0) {
    return <Text dimColor>No active Claude Code sessions found</Text>;
  }

  const cols = getColumnWidths();

  return (
    <Box flexDirection="column">
      <Box>
        <Text bold>{pad('Project', cols.project)}</Text>
        <Text bold>{pad('Branch', cols.branch)}</Text>
        <Text bold>{pad('Status', cols.status)}</Text>
        <Text bold>{pad('Activity', cols.activity)}</Text>
        <Text bold>{pad('Messages', cols.messages)}</Text>
      </Box>
      <Box>
        <Text dimColor>
          {'─'.repeat(
            cols.project +
              cols.branch +
              cols.status +
              cols.activity +
              cols.messages,
          )}
        </Text>
      </Box>
      {sessions.map((session) => (
        <Box key={session.sessionId}>
          <Text>
            {pad(truncate(session.projectName, cols.project - 1), cols.project)}
          </Text>
          <Text>
            {pad(truncate(session.gitBranch, cols.branch - 1), cols.branch)}
          </Text>
          <Box width={cols.status}>
            <StatusCell status={session.status} />
          </Box>
          <Box width={cols.activity}>
            <ActivityCell
              status={session.status}
              lastActive={session.lastActive}
              maxLen={cols.activity - 1}
            />
          </Box>
          <Text>{pad(String(session.messageCount), cols.messages)}</Text>
        </Box>
      ))}
    </Box>
  );
}
