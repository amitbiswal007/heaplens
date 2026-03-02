---
sidebar_position: 3
title: TypeScript Frontend
---

# TypeScript Frontend

The TypeScript side of HeapLens is a VS Code extension that manages the UI, process lifecycle, LLM integration, and source code bridging.

## Module Map

```
src/
├── extension.ts            # Activation, command registration, binary path resolution
├── hprofEditorProvider.ts  # Custom editor: spawns Rust, manages state, routes messages
├── rustClient.ts           # JSON-RPC 2.0 client wrapping the subprocess
├── webviewProvider.ts      # Generates all HTML/CSS/JS for the 7-tab webview
├── analysisContext.ts      # Formats analysis data into LLM-friendly markdown
├── llmClient.ts            # Streaming LLM API calls (Anthropic/OpenAI)
├── promptTemplates.ts      # System prompt and analysis prompt for LLM
├── chatParticipant.ts      # VS Code Copilot Chat integration (@heaplens mention)
├── sourceResolver.ts       # Maps class names to workspace source files
└── dependencyResolver.ts   # Maven/Gradle dependency lookup
```

## Extension Activation

`extension.ts` is the entry point. On activation it:

1. Creates an output channel (`HeapLens`) for logging
2. Registers `HprofEditorProvider` as a custom editor for `.hprof` files
3. Registers the `@heaplens` Copilot Chat participant
4. Initializes `DependencyResolver` for the active workspace
5. Registers two commands:
   - `heaplens.analyzeFile` — opens file picker, then opens `.hprof` file with the custom editor
   - `heaplens.exportJson` — exports the current analysis as structured JSON

## Custom Editor Provider

`HprofEditorProvider` implements `vscode.CustomReadonlyEditorProvider`. When the user opens a `.hprof` file:

1. Creates a webview panel with `retainContextWhenHidden: true` (preserves state when the tab is backgrounded)
2. Spawns a `RustClient` subprocess
3. Sends `analyze_heap` with the file path
4. Waits for `heap_analysis_complete` notification
5. Posts the full analysis data to the webview

### Per-Editor State

Each open `.hprof` file gets its own isolated state:

```typescript
interface EditorState {
    webviewPanel: vscode.WebviewPanel;
    analysisData: AnalysisData | null;
    chatHistory: ChatMessage[];           // max 40 messages
    pendingWebviewMessage: any;
    webviewReady: boolean;
    dependencyInfoCache: Map<string, DependencyInfo>;
}
```

State is stored in `Map<string, EditorState>` keyed by the `.hprof` file path. When the editor tab is closed, `webviewPanel.onDidDispose()` cleans up the state.

### Message Routing

The provider handles messages from the webview:

| Message | Handler | What It Does |
|---------|---------|--------------|
| `ready` | Sets `webviewReady = true` | Flushes buffered data to the webview |
| `getChildren` | `rustClient.sendRequest('get_children')` | Fetches dominator tree children |
| `gcRootPath` | `rustClient.sendRequest('gc_root_path')` | Computes GC root reference chain |
| `chatMessage` | `handleChatMessage()` | Sends to LLM with analysis context, streams response |
| `goToSource` | `handleGoToSource()` | Resolves class → file, opens in adjacent column |
| `queryDependencyInfo` | Cache lookup | Returns tier + dependency metadata |
| `copyReport` | `handleCopyReport()` | Generates markdown report, copies to clipboard |

## RustClient

`rustClient.ts` wraps the subprocess communication:

- Spawns `hprof-server` with `stdio: ['pipe', 'pipe', 'pipe']`
- Reads stdout line-by-line using `readline`
- Tracks pending requests in `Map<number, {resolve, reject}>` by request ID
- Supports notification handlers via `onNotification(method, callback)`
- Implements configurable request timeout (default 30s)

## Webview

`webviewProvider.ts` generates a single HTML document containing all 7 tabs. It is a self-contained page with:

- Tab bar with click handlers for switching tabs
- CSS styling matching VS Code's theme (uses CSS variables for dark/light mode)
- JavaScript for:
  - D3.js pie chart (Overview) and sunburst chart (Dominator Tree)
  - Sortable tables with click-to-sort column headers
  - Search/filter input for the Histogram tab
  - Expandable tree nodes that send `getChildren` messages
  - Chat input handling with streaming response display

The webview communicates with the extension host via `vscode.postMessage()` (outbound) and `window.addEventListener('message')` (inbound).

### Content Security Policy

The webview uses a strict CSP that allows:
- `script-src` with a per-session nonce for inline scripts
- CDN access for D3.js v7
- `style-src 'unsafe-inline'` for dynamic styling
- No `'unsafe-eval'` (D3.js v7 does not require it)

## LLM Integration

### Built-in Chat

`llmClient.ts` implements streaming API calls to Anthropic or OpenAI. The system message includes the full analysis context from `analysisContext.ts`.

### Copilot Chat Participant

`chatParticipant.ts` registers a `@heaplens` participant in VS Code's Copilot Chat. When mentioned, it injects the heap analysis context into the Copilot conversation.

## Source Bridge

### Source Resolution

`sourceResolver.ts` converts a fully-qualified class name to a workspace file path:

```
com.example.cache.DataCache
    → **/com/example/cache/DataCache.java
    → /workspace/src/main/java/com/example/cache/DataCache.java
```

### Dependency Resolution

`dependencyResolver.ts` parses `pom.xml` or `build.gradle` to identify third-party dependencies. Classes are classified into three tiers:

- **Core** — `java.*`, `javax.*`, `sun.*` packages
- **Third-party** — Classes matching a declared Maven/Gradle dependency
- **App** — Classes found as source files in the workspace
