#!/usr/bin/env node
import { Box, Text, render, useApp, useInput } from 'ink';
import React from 'react';

const App = () => {
  const { exit } = useApp();

  useInput((input) => {
    if (input === 'q') {
      exit();
    }
  });

  return (
    <Box flexDirection="column">
      <Text>Hello, Claude HUD!</Text>
      <Text dimColor>Press 'q' to quit</Text>
    </Box>
  );
};

render(<App />);
