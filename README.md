# LifeOS

A self-hosted, LAN-first personal life operating system designed to keep life from falling apart under stress, fatigue, and information overload.

[English](./README.md) | [中文](./README_CN.md)

## Why LifeOS

LifeOS is built around a simple problem: when energy, attention, and executive function drop, important parts of life can disappear into scattered notes, unfinished tasks, forgotten decisions, and accumulated uncertainty.

Its first goal is not to optimize every aspect of life. It is to notice when things are becoming unstable, preserve what matters, and help choose the next manageable action.

## Core Loop

LifeOS turns everyday conversation and fragments into a continuous context for reflection and action:

```text
Capture fragments and conversations
              ↓
Understand and record what matters
              ↓
Store memories, knowledge, tasks, threads, and daily states
              ↓
Read the accumulated context back into the Agent
              ↓
Choose the next manageable action
              ↓
Review patterns and recover before small problems become a collapse
```

The system is designed to let you record first and organize later. The AI helps interpret and connect the record; the local data store remains the source of truth.

## Design Principles

- **Stabilize before optimizing**: protect today's basic functioning before pursuing ambitious plans.
- **Capture before structure**: do not require a perfect taxonomy at the moment something happens.
- **Evidence before narrative**: long-term conclusions should be traceable to actual records.
- **Smallest useful action**: when energy is low, reduce the next step instead of adding pressure.
- **Local ownership**: personal data stays under the user's control; external LLM calls are explicit and configurable.

## Features

- **Self-Hosted, LAN-First Architecture**: The server and primary data live on your own PC; phones and other devices connect over the local network
- **AI-Powered Memory**: Automatic profile generation from memory entries using LLM
- **Memex Integration**: One-time import of memex backup archives
- **Client-Server Sync**: Live state updates between LAN clients and the PC server
- **Mobile Support**: Capacitor-based Android client, with the mobile shell extensible to iOS
- **Thread-Based Organization**: Organize memories into conversational threads

## Project Structure

```
LifeOS/
├── app/              # Frontend (React + TypeScript + Vite)
├── server/           # Backend (Node.js + TypeScript)
└── design/           # Architecture and UI/UX documentation
```

## Quick Start

### Prerequisites

- Node.js 20+
- npm or pnpm

### 1. Backend Setup

```bash
cd server
npm install
cp .env.example .env
# Edit .env to configure LLM provider and API key
npm run dev
```

Backend runs on `http://localhost:3456`

### 2. Frontend Setup (in a new terminal)

```bash
cd app
npm install
npm run dev -- --host
```

Frontend runs on `http://localhost:5173`

Then open [http://localhost:5173](http://localhost:5173) in your browser.

For a phone or another device on the same LAN, open `http://<PC-LAN-IP>:5173` instead. Keep the LifeOS server running on the PC; the frontend proxy forwards API requests to port 3456 on that PC.

## Environment Configuration

Create `server/.env`:

```env
# LLM Provider
LLM_PROVIDER=deepseek

# Model name (default: deepseek-chat)
LLM_MODEL=deepseek-chat

# API Key
LLM_API_KEY=sk-xxxxx

# Optional: Custom API base URL
# LLM_BASE_URL=https://api.deepseek.com/v1
```

See [server/.env.example](./server/.env.example) for more provider configurations (OpenAI, Ollama, etc.)

Supported LLM providers:
- **deepseek** (default)
- **openai**
- **ollama** (local)

## Architecture

### Data Model

```
State (server/data/state.json)
├── profile        # User avatar (≤800 chars, auto-generated)
├── memories[]     # Evidence layer (full memory entries)
├── knowledge[]    # Methods, resources, notes, and other durable knowledge
├── tasks[]        # Action layer
├── dailyStates[]  # Daily check-ins and energy state
└── threads[]      # Conversational threads
```

Memory are persisted as markdown files in `server/data/memory/` with YAML frontmatter:

```markdown
---
id: uuid
title: Memory title
createdAt: ISO-8601
confirmCount: number
tags: [tag1, tag2]
---

Memory content in markdown format.
```

### Client-Server State

- **PC server**: The authoritative state is stored locally on the host PC with atomic JSON writes to `state.json`
- **LAN clients**: The browser or mobile client keeps a localStorage copy for UI continuity and synchronizes with the PC server
- **Startup**: If server state is blank and local browser has data, frontend syncs local data back to server
- **Boundary**: This is not full offline-first sync yet; clients currently depend on the PC server for the complete application state
- **Clear**: Wipes all data from both server and client

### Profile Generation Pipeline

1. **Evidence Layer**: All memory entries in `state.memories`
2. **Selection**: Top 40 memories by `confirmCount`
3. **LLM Synthesis**: DeepSeek rewrites profile based on selected memories
4. **Summary Layer**: Profile (<800 chars) injected into chat context
5. **Trigger**: Updates when ≥5 new memories are unsync'd with current profile

## Memex Integration

Import memories from [memex](https://github.com/memex-lab/memex) backup:

1. Export memex backup as `.memex` ZIP file
2. In LifeOS Settings → Memex, upload the ZIP
3. One-time import of Cards (as MemoryEntry) and PKM (as KnowledgeItem)

**Note**: LifeOS only supports memex's backup data format (ZIP + YAML/Markdown parsing); it does not include memex source code. See [NOTICE.md](./NOTICE.md) for attribution details.

## Development

### Available Scripts

**Backend:**
```bash
npm run dev          # Start dev server with file watching
npm run typecheck    # Verify TypeScript types
```

**Frontend:**
```bash
npm run dev          # Start Vite dev server with HMR
npm run build        # Build for production
npm run preview      # Preview production build
npm run lint         # Run ESLint
```

### API Endpoints

- `GET /api/state` — Fetch current state
- `PUT /api/state` — Update state
- `POST /api/chat` — Chat with AI agent
- `POST /api/import/memex` — Import memex backup ZIP

See `server/src/index.ts` for full API specification.

### Type Definitions

```bash
cd server
  npm run typecheck    # Verify TypeScript types
```

## Mobile Build

### Android APK

```bash
cd app
npx cap add android
npx cap sync android
npx cap build android
```

See [docs/APK-BUILD.md](./docs/APK-BUILD.md) for detailed build instructions.

## Privacy & Data

- **Self-hosted data**: Primary data is stored on the host PC; no cloud sync or telemetry is enabled by default
- **No user tracking**: You own your memories
- **LLM calls are explicit**: Chat, capture extraction, profile synthesis, and Dream may send selected local context to the configured LLM API
- **Memex import is one-time**: No ongoing sync with memex after import

## License & Attribution

- **LifeOS**: [MIT License](./LICENSE)
- **memex interoperability**: LifeOS only supports memex's backup data format; it does not include memex source code. See [NOTICE.md](./NOTICE.md) for details.
- **UI Components**: Uses [shadcn/ui](https://ui.shadcn.com/) (MIT)
- **Framework**: [React](https://react.dev/), [Vite](https://vitejs.dev/), [Capacitor](https://capacitorjs.com/)

## Security boundary

The development server intentionally listens on the local network so an
Android client can connect and agents can be debugged from another device.
The current LAN mode has no authentication: use it only on a trusted private
network, keep the firewall enabled, and never expose port 3456 to the public
Internet. See [SECURITY.md](./SECURITY.md).

## Contributing

We welcome bug reports, feature requests, and pull requests. Please see [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

## Troubleshooting

### Port Already in Use

- Backend (3456): stop the running process with `Ctrl+C`, or change `LIFEOS_PORT` in the server environment
- Frontend (5173): Vite will auto-increment port; check terminal output

### LLM API Errors

- Check `.env` has correct API key and base URL
- Verify network connectivity to LLM provider
- Check `server/src/llm.ts` logs for detailed error messages

### State Sync Issues

- Clear browser cache and localStorage: DevTools → Application → Clear Storage
- Verify backend is running: `curl.exe http://localhost:3456/api/state`
- Check `server/data/state.json` exists and is valid JSON

## Roadmap

- [ ] Offline-first sync (IndexedDB for large datasets)
- [ ] End-to-end encryption option
- [ ] Multi-device sync with server backend
- [ ] iOS native build optimization
- [ ] Plugin system for extending AI behavior

---

**Questions?** Open an issue or discussion in this repository.
