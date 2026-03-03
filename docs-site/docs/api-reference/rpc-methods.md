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

---

## inspect_object

Returns the field-level details of a specific object, including primitive values and reference information. Requires a prior `analyze_heap` for the same file path.

### Request

```json
{
  "jsonrpc": "2.0",
  "id": 5,
  "method": "inspect_object",
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
  "id": 5,
  "result": [
    {
      "name": "size",
      "field_type": "int",
      "primitive_value": "16",
      "ref_object_id": null,
      "ref_summary": null
    },
    {
      "name": "loadFactor",
      "field_type": "float",
      "primitive_value": "0.75",
      "ref_object_id": null,
      "ref_summary": null
    },
    {
      "name": "table",
      "field_type": "reference",
      "primitive_value": null,
      "ref_object_id": 234567,
      "ref_summary": "HashMap$Node[] (retained: 4.2 MB)"
    }
  ]
}
```

Each element in the result array is a `FieldInfo` object with the following fields:

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | The field name as declared in the class |
| `field_type` | string | The type of the field (`int`, `long`, `boolean`, `reference`, etc.) |
| `primitive_value` | string or null | The string representation of the value for primitive fields; `null` for references |
| `ref_object_id` | number or null | The object ID of the referenced object; `null` for primitive fields |
| `ref_summary` | string or null | A human-readable summary of the referenced object (class name and retained size); `null` for primitive fields |

---

## execute_query

Executes a HeapQL query against an analyzed heap dump. HeapQL is a SQL-like query language for ad-hoc heap interrogation. Requires a prior `analyze_heap` for the same file path.

### Request

```json
{
  "jsonrpc": "2.0",
  "id": 6,
  "method": "execute_query",
  "params": {
    "path": "/tmp/heap.hprof",
    "query": "SELECT class_name, retained_size FROM objects WHERE class_name LIKE '%Cache%' ORDER BY retained_size DESC LIMIT 10"
  }
}
```

### Response

```json
{
  "jsonrpc": "2.0",
  "id": 6,
  "result": {
    "columns": ["class_name", "retained_size"],
    "rows": [
      ["com.example.cache.LRUCache", 536870912],
      ["com.example.cache.SessionCache", 134217728],
      ["com.example.cache.ImageCache", 67108864]
    ],
    "total_scanned": 1250000,
    "total_matched": 3,
    "execution_time_ms": 142
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `columns` | string[] | The column names matching the SELECT clause |
| `rows` | array[] | An array of result rows, each row being an array of values corresponding to the columns |
| `total_scanned` | number | The total number of objects scanned during query execution |
| `total_matched` | number | The number of objects matching the query predicate |
| `execution_time_ms` | number | The wall-clock time in milliseconds to execute the query |

---

## compare_heaps

Compares two analyzed heap dumps and returns the delta between them. Both heap dumps must have been previously analyzed via `analyze_heap`.

### Request

```json
{
  "jsonrpc": "2.0",
  "id": 7,
  "method": "compare_heaps",
  "params": {
    "current_path": "/tmp/heap-after.hprof",
    "baseline_path": "/tmp/heap-before.hprof"
  }
}
```

### Response

```json
{
  "jsonrpc": "2.0",
  "id": 7,
  "result": {
    "summary_delta": {
      "total_objects_diff": 15000,
      "total_size_diff": 67108864,
      "total_classes_diff": 5
    },
    "class_histogram_diff": [
      {
        "class_name": "com.example.DataRecord",
        "instance_count_diff": 12000,
        "shallow_size_diff": 576000,
        "retained_size_diff": 52428800
      },
      {
        "class_name": "java.lang.String",
        "instance_count_diff": 3000,
        "shallow_size_diff": 72000,
        "retained_size_diff": 14680064
      }
    ],
    "leak_suspect_changes": {
      "new_suspects": [
        {
          "class_name": "com.example.DataRecord",
          "retained_size": 52428800,
          "percentage": 12.5
        }
      ],
      "resolved_suspects": [],
      "persistent_suspects": [
        {
          "class_name": "com.example.cache.LRUCache",
          "retained_size_before": 536870912,
          "retained_size_after": 536870912
        }
      ]
    }
  }
}
```

The comparison result contains:

| Field | Type | Description |
|-------|------|-------------|
| `summary_delta` | object | High-level differences: object count change, total size change, class count change |
| `class_histogram_diff` | array | Per-class differences sorted by absolute retained size change (descending). Each entry includes `class_name`, `instance_count_diff`, `shallow_size_diff`, and `retained_size_diff`. |
| `leak_suspect_changes` | object | Categorized leak suspect changes: `new_suspects` (appeared in current but not baseline), `resolved_suspects` (present in baseline but not current), and `persistent_suspects` (present in both) |

---

## list_analyzed_files

Returns the list of heap dump file paths that are currently loaded and analyzed by the server. Takes no parameters.

### Request

```json
{
  "jsonrpc": "2.0",
  "id": 8,
  "method": "list_analyzed_files",
  "params": {}
}
```

### Response

```json
{
  "jsonrpc": "2.0",
  "id": 8,
  "result": [
    "/tmp/heap.hprof",
    "/tmp/heap-before.hprof",
    "/tmp/heap-after.hprof"
  ]
}
```

Returns an empty array if no files have been analyzed yet. This method is useful for verifying server state and for tooling that needs to discover which files are available for further queries (e.g., `compare_heaps`, `execute_query`).
