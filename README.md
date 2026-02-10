# claudpit

A terminal dashboard for monitoring active Claude Code sessions in real-time.

<img width="824" height="148" alt="image" src="https://github.com/user-attachments/assets/f1365c9b-e835-4950-8e38-a5f37ffa1a59" />

## Features

- **Live session monitoring** — auto-refreshing table of all Claude Code sessions on your machine
- **Smart status detection** — determines whether each session is running, waiting, idle, or inactive by analyzing session logs and process state
- **Rich session info** — shows project name, git branch, status, time since last activity, and message count
- **Project detection** — resolves project names from `package.json`, `Cargo.toml`, `pyproject.toml`, `go.mod`, and Gradle configs
- **Keyboard shortcuts** — press `q` to quit, `i` to toggle inactive sessions

## Prerequisites

- Node.js 18+
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) installed
- macOS or Linux

## Installation

```bash
npm install -g claudpit
```

## Usage

```bash
claudpit
```

### Status Indicators

| Indicator | Status | Meaning |
|-----------|--------|---------|
| 🟢 | Running | Claude is actively processing |
| 🟡 | Waiting | Tool calls pending resolution |
| 🔵 | Idle | Session completed work but remains active |
| 🔴 | Inactive | Session process is no longer running |

### Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `q` | Quit |
| `i` | Toggle inactive sessions |

## Development

```bash
git clone https://github.com/eshaham/claudpit.git
cd claudpit
npm install
```

### Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start in development mode with live reload |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm run lint` | Run ESLint |
| `npm run lint:fix` | Run ESLint with auto-fix |
| `npm run format` | Format source files with Prettier |
| `npm run format:check` | Check formatting without writing |

## Contributing

Contributions are welcome! Here's how to get started:

1. Fork the repository
2. Create a branch for your change
3. Make your changes
4. Run `npm run lint` and `npm run format` to ensure code quality
5. Open a pull request

Pre-commit hooks will automatically run Prettier, ESLint, and TypeScript type checking on staged files.

## License

[MIT](LICENSE)
