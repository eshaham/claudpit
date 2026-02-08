#!/usr/bin/env node
import { Box, Text, render, useApp, useInput } from 'ink';
import React, { useMemo, useState } from 'react';

import { SessionTable } from '~/components/SessionTable.js';
import { useSessions } from '~/hooks/useSessions.js';

const App = () => {
  const { exit } = useApp();
  const sessions = useSessions();
  const [showInactive, setShowInactive] = useState(false);

  const filtered = useMemo(
    () =>
      showInactive ? sessions : sessions.filter((s) => s.status !== 'inactive'),
    [sessions, showInactive],
  );

  useInput((input) => {
    if (input === 'q') {
      exit();
    }
    if (input === 'i') {
      setShowInactive((prev) => !prev);
    }
  });

  const inactiveCount = sessions.length - filtered.length;

  return (
    <Box flexDirection="column">
      <SessionTable sessions={filtered} />
      {inactiveCount > 0 && !showInactive && (
        <Box marginTop={1}>
          <Text dimColor>
            {inactiveCount} inactive session{inactiveCount > 1 ? 's' : ''}{' '}
            hidden
          </Text>
        </Box>
      )}
      <Box marginTop={inactiveCount > 0 && !showInactive ? 0 : 1}>
        <Text dimColor>
          'q' quit | 'i' {showInactive ? 'hide' : 'show'} inactive |
          Auto-refresh: 5s
        </Text>
      </Box>
    </Box>
  );
};

render(<App />);
