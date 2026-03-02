---
sidebar_position: 1
title: JSON-RPC Methods
---

# JSON-RPC Methods

The `hprof-server` binary exposes these methods in JSON-RPC mode (default, used by the VS Code extension). All communication is newline-delimited JSON over stdin/stdout.

## analyze_heap

Triggers a full heap analysis. Returns immediately with a processing acknowledgment, then sends a `heap_analysis_complete` notification when done.

### Request

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "analyze_heap",
  "params": {
    "path": "/tmp/heap.hprof"
  }
}
```

### Immediate Response

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "status": "processing",
    "request_id": 1
  }
}
```

### Completion Notification

```json
{
  "jsonrpc": "2.0",
  "method": "heap_analysis_complete",
  "params": {
    "request_id": 1,
    "status": "completed",
    "top_objects": [ /* ObjectReport[] */ ],
    "top_layers": [ /* ObjectReport[] (filtered, top 20) */ ],
    "summary": { /* HeapSummary */ },
    "class_histogram": [ /* ClassHistogramEntry[] */ ],
    "leak_suspects": [ /* LeakSuspect[] */ ],
    "waste_analysis": { /* WasteAnalysis */ }
  }
}
```

### Error Notification

```json
{
  "jsonrpc": "2.0",
  "method": "heap_analysis_complete",
  "params": {
    "request_id": 1,
    "status": "error",
    "error": "Failed to load HPROF file: No such file or directory"
  }
}
```

---

## get_children

Returns the children of a specific object in the dominator tree. Requires a prior `analyze_heap` for the same file path.

### Request

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "get_children",
  "params": {
    "path": "/tmp/heap.hprof",
    "object_id": 123456
  }
}
```

### Response

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": [
    {
      "object_id": 234567,
      "node_type": "Instance",
      "class_name": "java.util.HashMap",
      "shallow_size": 48,
      "retained_size": 536870912
    }
  ]
}
```

Returns an empty array if the object is a leaf node or the object ID is not found.

---

## gc_root_path

Computes the shortest reference path from GC roots to a specific object.

### Request

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "gc_root_path",
  "params": {
    "path": "/tmp/heap.hprof",
    "object_id": 789012
  }
}
```

### Response

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "result": [
    { "object_id": 0, "node_type": "Root", "class_name": "Thread main", "shallow_size": 0, "retained_size": 0 },
    { "object_id": 111, "node_type": "Instance", "class_name": "com.example.AppContext", "shallow_size": 64, "retained_size": 1073741824 },
    { "object_id": 789012, "node_type": "Instance", "class_name": "com.example.DataCache", "shallow_size": 48, "retained_size": 536870912 }
  ]
}
```

The path is ordered from root to target. The maximum depth is 100 nodes.

---

## export_json

Exports the analysis results as a structured JSON file.

### Request

```json
{
  "jsonrpc": "2.0",
  "id": 4,
  "method": "export_json",
  "params": {
    "path": "/tmp/heap.hprof",
    "output_path": "/tmp/heap-analysis.json"
  }
}
```

### Response

```json
{
  "jsonrpc": "2.0",
  "id": 4,
  "result": {
    "success": true
  }
}
```

The exported JSON file contains `summary`, `class_histogram`, `leak_suspects`, and `top_objects` in a structured format suitable for programmatic consumption.
