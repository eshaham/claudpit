#!/usr/bin/env node
import { Box, Text, render, useApp, useInput } from 'ink';
import React from 'react';

import { SessionTable } from '~/components/SessionTable.js';
import { useSessions } from '~/hooks/useSessions.js';

const App = () => {
  const { exit } = useApp();
  const sessions = useSessions();

  useInput((input) => {
    if (input === 'q') {
      exit();
    }
  });

  return (
    <Box flexDirection="column">
      <SessionTable sessions={sessions} />
      <Box marginTop={1}>
        <Text dimColor>Press 'q' to quit | Auto-refresh: 5s</Text>
      </Box>
    </Box>
  );
};

render(<App />);
