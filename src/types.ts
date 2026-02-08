export type SessionStatus = 'running' | 'waiting' | 'inactive';

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
  fullPath: string;
  gitBranch: string;
  projectPath: string;
  modified: string;
  messageCount: number;
  created: string;
  isSidechain: boolean;
}

export interface SessionIndex {
  version: number;
  entries: SessionIndexEntry[];
}
