export type SessionStatus = 'running' | 'waiting' | 'stale';

export interface SessionRow {
  sessionId: string;
  projectPath: string;
  projectName: string;
  gitBranch: string;
  status: SessionStatus;
  lastActive: Date;
  messageCount: number;
}

export interface SessionIndexEntry {
  sessionId: string;
  gitBranch: string;
  projectPath: string;
  modified: string;
  messageCount: number;
  created: string;
  isSidechain: boolean;
}
