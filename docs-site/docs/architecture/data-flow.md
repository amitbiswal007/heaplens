---
sidebar_position: 4
title: Data Flow
---

# Data Flow

This page traces data through the entire HeapLens system, from HPROF bytes on disk to pixels on screen.

## Analysis Data Flow

### 1. HPROF File → Rust Analysis Engine

```
.hprof file (binary on disk)
    │
    ▼  memmap2: zero-copy memory mapping
Raw bytes (&[u8])
    │
    ▼  jvm-hprof: record parsing
Records (UTF8, LoadClass, HeapDump segments)
    │
    ▼  build_graph() Pass 1: nodes
Graph nodes (Instance, Array, Class, GCRoot)
    │
    ▼  build_graph() Pass 2: edges + waste data
HeapGraph + WasteRawData
    │
    ▼  calculate_dominators_with_state()
AnalysisState {
    retained_sizes, shallow_sizes,
    children_map, class_histogram,
    leak_suspects, waste_analysis,
    reverse_refs, summary
}
```

### 2. Rust → TypeScript (JSON-RPC Notification)

The Rust server serializes the analysis results into a JSON notification:

```json
{
  "jsonrpc": "2.0",
  "method": "heap_analysis_complete",
  "params": {
    "request_id": 1,
    "status": "completed",
    "top_objects": [
      { "object_id": 123, "class_name": "com.example.DataCache",
        "node_type": "Instance", "shallow_size": 48, "retained_size": 536870912 }
    ],
    "top_layers": [...],
    "summary": {
      "total_heap_size": 222298112,
      "reachable_heap_size": 171245568,
      "total_instances": 2847312,
      "total_classes": 8421,
      "total_arrays": 612455,
      "total_gc_roots": 3847
    },
    "class_histogram": [...],
    "leak_suspects": [...],
    "waste_analysis": {
      "total_wasted_bytes": 47396864,
      "waste_percentage": 8.8,
      "duplicate_string_wasted_bytes": 37322752,
      "empty_collection_wasted_bytes": 10074112,
      "duplicate_strings": [...],
      "empty_collections": [...]
    }
  }
}
```

### 3. TypeScript → Webview (postMessage)

The `HprofEditorProvider` extracts the notification params and forwards them to the webview:

```typescript
webviewPanel.webview.postMessage({
    command: 'analysisComplete',
    data: {
        topObjects: params.top_objects,
        topLayers: params.top_layers,
        summary: params.summary,
        classHistogram: params.class_histogram,
        leakSuspects: params.leak_suspects,
        wasteAnalysis: params.waste_analysis,
    }
});
```

### 4. Webview Renders All Tabs

The webview's `message` event handler dispatches to tab-specific render functions:

```javascript
window.addEventListener('message', event => {
    const msg = event.data;
    if (msg.command === 'analysisComplete') {
        renderOverview(msg.data.summary, msg.data.topObjects);
        renderHistogram(msg.data.classHistogram);
        renderLeakSuspects(msg.data.leakSuspects);
        renderWaste(msg.data.wasteAnalysis);
        // Dominator tree, Source, Chat initialized with data references
    }
});
```

## Interaction Data Flows

### Dominator Tree Drill-Down

```
User clicks ▶ on tree node (objectId: 456)
    │
    ▼  webview → postMessage
{ command: 'getChildren', objectId: 456 }
    │
    ▼  HprofEditorProvider message handler
rustClient.sendRequest('get_children', { path, object_id: 456 })
    │
    ▼  JSON-RPC request over stdin
{"jsonrpc":"2.0","id":5,"method":"get_children","params":{"path":"/tmp/heap.hprof","object_id":456}}
    │
    ▼  hprof-server: AnalysisState.get_children(456)
Looks up NodeIndex for object_id 456 in id_to_node map
Returns children from children_map, sorted by retained size
    │
    ▼  JSON-RPC response over stdout
{"jsonrpc":"2.0","id":5,"result":[{"object_id":789,"class_name":"HashMap",...},...]
    │
    ▼  RustClient resolves pending promise
    │
    ▼  HprofEditorProvider → postMessage to webview
{ command: 'childrenResponse', objectId: 456, children: [...] }
    │
    ▼  Webview inserts child nodes under the expanded parent
```

**Round-trip time:** Typically < 10ms (all data is in-memory after initial analysis).

### AI Chat Message

```
User types "What is the biggest memory consumer?" and clicks Send
    │
    ▼  webview → postMessage
{ command: 'chatMessage', text: "What is the biggest memory consumer?" }
    │
    ▼  HprofEditorProvider.handleChatMessage()
    │
    ├─ If first message: prepend formatAnalysisContext(analysisData)
    │   as system context (~2-3K tokens of heap summary)
    │
    ▼  llmClient.streamLlmResponse(messages, config)
    │
    ├─ Stream chunk 1 → postMessage({ command: 'chatChunk', text: "Based on..." })
    ├─ Stream chunk 2 → postMessage({ command: 'chatChunk', text: "the heap..." })
    └─ Stream done    → postMessage({ command: 'chatDone' })
    │
    ▼  Webview renders response progressively
```

### GC Root Path

```
User clicks pin icon on object (objectId: 789)
    │
    ▼  webview → postMessage
{ command: 'gcRootPath', objectId: 789 }
    │
    ▼  HprofEditorProvider → rustClient.sendRequest('gc_root_path', ...)
    │
    ▼  hprof-server: AnalysisState.gc_root_path(789, max_depth=100)
BFS backward through reverse_refs from target to SuperRoot
    │
    ▼  Returns path as Vec<ObjectReport>
[Root("Thread main"), Instance("AppContext"), Instance("DataCache"), Instance("HashMap")]
    │
    ▼  webview renders breadcrumb trail
Thread "main" → AppContext → DataCache → HashMap
```

## Data Persistence

HeapLens does not persist analysis results across VS Code sessions. Each time a `.hprof` file is opened, a fresh analysis is performed. The `export_json` command allows explicit persistence to a JSON file.

The Rust server's `AnalysisState` is cached per file path for the duration of the editor session. Closing the editor tab kills the subprocess and discards the state.
