# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

All commands are run from the repo root (`MQTT-explorer/`).

### Development

```bash
# Desktop (Electron) — hot-reload all layers in parallel
yarn dev

# Browser mode (Express + Socket.io) — hot-reload
yarn dev:server
```

### Build

```bash
# Desktop
yarn build          # tsc + webpack (production)

# Browser / server
yarn build:server   # tsc + webpack.browser.config.mjs
```

### Tests

```bash
# All tests
yarn test                    # app + backend suites
yarn test:all                # + demo video

# Per-workspace
yarn test:app                # cd app && yarn test  (mocha/tsx, React components)
yarn test:backend            # cd backend && yarn test  (mocha/tsx, model/data tests)

# Single test file (backend)
cd backend && NODE_PATH=../node_modules mocha --require tsx --require source-map-support/register src/path/to/file.spec.ts

# Single test file (app)
cd app && mocha --require tsx --require source-map-support/register src/path/to/file.spec.ts

# Coverage (backend)
cd backend && yarn coverage

# UI/E2E (requires Playwright & running app)
yarn test:ui
```

### Lint

```bash
yarn lint             # prettier + eslint + cspell (parallel)
yarn lint:fix         # eslint + prettier auto-fix
```

### Start (production build required first)

```bash
yarn start            # Electron desktop
yarn start:server     # Node.js web server on :3000
```

---

## Architecture

The project is split into four layers that share TypeScript source from a common `events/` package.

```
MQTT-explorer/
├── src/              # Electron main process + Node.js server entry points
├── app/              # React renderer (webpack, runs in browser/Electron renderer)
├── backend/          # MQTT connection model; shared by Electron & server
├── events/           # Typed event contracts and event-bus implementations
```

### `events/` — shared typed event contracts

The glue between every other layer. All cross-process or cross-layer communication is expressed as typed `Event` objects defined here. The `EventSystem/` subdirectory provides several bus implementations that share the same `EventBusInterface`:

- **`EventBus.ts`** (Electron) — IpcMain / IpcRenderer buses + `Rpc` helper.
- **`SocketIOServerEventBus`** / **`SocketIOClientEventBus`** — server ↔ browser bus over Socket.io.
- **`Rpc`** — thin request/response wrapper over any `EventBusInterface`.

This means the application logic in `app/` is the same whether it runs in Electron or a browser; only the concrete bus implementation differs.

### `backend/` — MQTT connection management & data model

- **`ConnectionManager`** (`src/index.ts`) — subscribes to `addMqttConnectionEvent`, creates one `DataSource / MqttSource` per connection, routes incoming MQTT messages back through the event bus to the correct client.
- **`Model/`** — pure data structures: `Tree`, `TreeNode`, `TreeNodeFactory`, `Message`, `RingBuffer`, `MessageHistory`, `Base64Message`.
- **`DataSource/`** — `MqttSource` wraps [MQTT.js](https://github.com/mqttjs/MQTT.js) and manages the connection state machine.
- **`ConfigStorage`** — persists connection profiles with `lowdb`.
- Tests live in `src/spec/` and `src/*/**/*.spec.ts`.

### `app/` — React renderer

- **Redux store** (`src/store.ts`) with slices: `tree`, `connection`, `connectionManager`, `publish`, `charts`, `sidebar`, `settings`, `globalState`.
- **Components** are under `src/components/`: `Tree/`, `Sidebar/`, `Chart/`, `ConnectionSetup/`, `Layout/`, etc.
- **`browserEventBus.ts`** — creates the Socket.io client bus and `Rpc` instance that the app uses in browser mode.
- **`eventBus.ts`** — selects the right bus implementation at runtime (IPC in Electron, Socket.io in browser).
- Built with webpack; `webpack.browser.config.mjs` targets browser-only deployment.

### `src/` — host-process entry points

- **`electron.ts`** — Electron main process: creates `BrowserWindow`, wires up IPC buses, `ConnectionManager`, auto-updater.
- **`server.ts`** — Express + Socket.io server for browser mode: exposes the same MQTT management over HTTP/WebSocket, adds auth (`AuthManager`) and LLM proxy endpoints.
- **`AuthManager.ts`** — bcrypt credential management for browser-mode deployment (`data/credentials.json`).

### LLM / AI assistant

Configured entirely via environment variables (`LLM_PROVIDER`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `LLM_API_KEY`). The backend proxies all LLM calls through the WebSocket RPC (`llm/chat` event); the frontend only receives an availability flag — no keys are ever sent to the renderer.

### Browser mode authentication

Set `MQTT_EXPLORER_USERNAME` + `MQTT_EXPLORER_PASSWORD` (env vars) to enable the built-in login. Set `MQTT_EXPLORER_SKIP_AUTH=true` to disable it when deploying behind an external auth proxy (OAuth2, SSO, etc.).
