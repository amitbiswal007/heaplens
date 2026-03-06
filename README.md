# HeapLens

**The fastest way to understand Java heap dumps — right inside VS Code.**

HeapLens is an LLM-powered `.hprof` analyzer built on a native Rust engine. Open any heap dump and instantly explore dominator trees, class histograms, leak suspects, and more through an interactive tabbed UI. Ask questions in plain English and get structured HeapQL query results.

![HeapLens Overview](https://raw.githubusercontent.com/sachinkg12/HeapScope/main/media/screenshots/overview.png)

---

## Features

### 10 Interactive Tabs

| Tab | What it does |
|-----|-------------|
| **Overview** | Heap stats, top objects, D3.js pie & bar charts |
| **Histogram** | Sortable class table with instance counts and sizes — click a class to list all instances |
| **Dominator Tree** | Expandable lazy-loaded tree with retained size bars, field names, and action buttons |
| **Leak Suspects** | Objects/classes retaining >10% of heap, with adjustable threshold slider |
| **Waste** | Duplicate strings, empty collections, over-allocated arrays, boxed primitives |
| **Source** | Jump to Java source — workspace files, Maven/Gradle dependency JARs, or CFR decompilation |
| **Query** | HeapQL: SQL-like queries with autocomplete, syntax highlighting, and query history |
| **Compare** | Diff two heap dumps side-by-side by class |
| **Timeline** | Multi-snapshot trend analysis with D3.js line charts |
| **AI Chat** | Ask questions in English — get HeapQL queries and insights |

### Dominator Tree Actions

Every node in the dominator tree has one-click actions:

- **Why alive?** — shows the shortest GC root path as a breadcrumb
- **Inspect** — opens a field-level inspector panel with primitive values and reference links
- **Go to source** — jumps to the `.java` file (workspace, dependency JAR, or decompiled)
- **Show referrers** — "Who references this object?" with recursive drill-down

### HeapQL Query Language

A SQL-like language purpose-built for heap analysis:

```sql
-- Find all HashMaps retaining more than 1MB
SELECT * FROM instances
WHERE class_name = 'java.util.HashMap' AND retained_size > 1MB
ORDER BY retained_size DESC

-- Top 10 classes by total retained size
SELECT class_name, COUNT(*), SUM(retained_size)
FROM instances
GROUP BY class_name
ORDER BY SUM(retained_size) DESC LIMIT 10

-- GC root path for a specific object
:path 123456789

-- Who references this object?
:refs 123456789
```

**Tables:** `instances`, `class_histogram`, `dominator_tree`, `leak_suspects`
**Aggregates:** `COUNT`, `SUM`, `AVG`, `MIN`, `MAX`
**Size literals:** `1KB`, `5MB`, `1GB`

### AI-Powered Analysis

Configure any of the 10 supported LLM providers and ask questions in the **AI Chat** tab. Supports **Anthropic**, **OpenAI**, **Google Gemini**, **DeepSeek**, **Mistral**, **Groq**, **xAI (Grok)**, **Together AI**, **OpenRouter**, and **Ollama** (local):

> *"What's causing the high memory usage?"*
> *"Show me the top 10 classes by retained size"*
> *"Why is this HashMap so large?"*

The LLM responds with explanations **and** runnable HeapQL queries. Click **Run Query** to execute them inline.

### Instance Enumeration

Click any class name in the **Histogram** tab to see all instances of that class. Each instance row has action buttons for inspect, show referrers, and "Why alive?" — no need to manually write queries.

### Source Code Bridge

Three-tier source resolution:

1. **Workspace** — finds `.java` files in your project
2. **Dependencies** — extracts from Maven/Gradle source JARs (`~/.m2`, `~/.gradle`)
3. **Decompilation** — falls back to CFR decompiler when source JARs are unavailable

### Waste Detection

Finds memory waste patterns automatically:

- **Duplicate strings** — identical string values held multiple times
- **Empty collections** — `HashMap`, `ArrayList`, etc. with zero elements
- **Over-allocated collections** — arrays sized far beyond their element count
- **Boxed primitives** — `Integer`, `Long`, etc. that could be primitive

### Snapshot Comparison & Timeline

- **Compare** two heap dumps: see which classes grew, shrank, or appeared/disappeared
- **Timeline** multiple snapshots: track heap growth trends over time with interactive charts

---

## Getting Started

1. **Install** HeapLens from the VS Code Marketplace
2. **Open** any `.hprof` file — HeapLens activates automatically
3. **Explore** the 10 tabs: Overview for a summary, Histogram to find big classes, Dominator Tree to drill down

### Generate a Heap Dump

```bash
# From a running JVM
jmap -dump:format=b,file=heap.hprof <pid>

# On OutOfMemoryError (add to JVM args)
-XX:+HeapDumpOnOutOfMemoryError -XX:HeapDumpPath=./heap.hprof

# Android (via adb)
adb shell am dumpheap <pid> /data/local/tmp/heap.hprof
adb pull /data/local/tmp/heap.hprof
```

### AI Chat Setup (Optional)

1. Go to **Settings** > search `heaplens.llm`
2. Set `heaplens.llm.provider` to your preferred provider (Anthropic, OpenAI, Gemini, DeepSeek, Mistral, Groq, xAI, Together AI, OpenRouter, or Ollama)
3. Set `heaplens.llm.apiKey` to your API key (not needed for Ollama)
4. Open the **AI Chat** tab and start asking questions

---

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `heaplens.llm.provider` | `anthropic` | LLM provider (anthropic, openai, gemini, deepseek, mistral, groq, xai, together, openrouter, ollama) |
| `heaplens.llm.apiKey` | — | API key for the LLM provider |
| `heaplens.llm.baseUrl` | — | Custom API base URL (for proxies or self-hosted) |
| `heaplens.llm.model` | — | Model name override |
| `heaplens.sourceResolution.enabled` | `true` | Enable dependency source JAR resolution |
| `heaplens.sourceResolution.mavenHome` | — | Custom Maven repository path |
| `heaplens.sourceResolution.gradleHome` | — | Custom Gradle cache path |
| `heaplens.sourceResolution.decompilerEnabled` | `true` | Enable CFR decompilation fallback |

---

## Architecture

```
VS Code Extension (TypeScript)
  └─ HprofEditorProvider (custom editor for .hprof)
      └─ RustClient (JSON-RPC 2.0 over stdin/stdout)
          └─ hprof-server (async Rust + tokio)
              └─ Analysis engine (petgraph dominator tree,
                 HeapQL query engine, waste analysis)
```

- **Rust engine** — zero-copy mmap parsing, petgraph-based dominator tree, O(n) retained size computation
- **TypeScript extension** — VS Code custom editor, webview UI, LLM integration
- **MCP server** — `hprof-server --mcp` for use with Claude Desktop, Cline, and other AI clients

---

## Supported Formats

- Java HotSpot HPROF (JDK 8+)
- Android HPROF (Dalvik/ART)
- HPROF versions: 1.0.1, 1.0.2, 1.0.3

---

## Commands

| Command | Description |
|---------|-------------|
| `HeapLens: Analyze HPROF File` | Open a file picker to select and analyze a `.hprof` file |
| `HeapLens: Export Analysis to JSON` | Export the current analysis results to a JSON file |

---

## Requirements

- VS Code 1.109.0 or later
- No additional dependencies — the native Rust binary is bundled with the extension

**Optional:**
- Java on `PATH` (for CFR decompilation fallback)
- Maven/Gradle project (for dependency source resolution)
- Anthropic or OpenAI API key (for AI Chat)

---

## Performance

HeapLens uses a native Rust binary for parsing and analysis. Typical performance on Apple M1:

| Heap Size | Parse + Analyze | Memory Usage |
|-----------|----------------|--------------|
| 50 MB | ~2 seconds | ~200 MB |
| 250 MB | ~15 seconds | ~1 GB |
| 1 GB | ~60 seconds | ~4 GB |

---

## License

[Apache 2.0](LICENSE)
