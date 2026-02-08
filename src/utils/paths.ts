import { join } from 'node:path';

export const CLAUDE_PROJECTS_DIR = join(
  process.env.HOME ?? process.env.USERPROFILE ?? '',
  '.claude',
  'projects',
);
