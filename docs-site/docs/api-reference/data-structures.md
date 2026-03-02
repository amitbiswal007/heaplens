---
sidebar_position: 2
title: Data Structures
---

# Data Structures

These are the JSON data structures used in HeapLens's JSON-RPC protocol and MCP responses.

## ObjectReport

Represents a single object in the heap. Returned by `analyze_heap` (in `top_objects` and `top_layers`) and by `get_children`.

```typescript
interface ObjectReport {
  object_id: number;      // HPROF object ID (unique address)
  node_type: string;      // "Instance" | "Array" | "Class" | "Root" | "SuperRoot"
  class_name: string;     // Fully-qualified class name, e.g., "java.util.HashMap"
  shallow_size: number;   // Bytes: the object's own memory footprint
  retained_size: number;  // Bytes: total memory freed if this object were collected
}
```

## HeapSummary

Aggregate statistics for the entire heap. Returned in the `summary` field of `heap_analysis_complete`.

```typescript
interface HeapSummary {
  total_heap_size: number;      // Total bytes of all objects
  reachable_heap_size: number;  // Bytes reachable from GC roots
  total_instances: number;      // Count of Instance objects
  total_classes: number;        // Count of loaded classes
  total_arrays: number;         // Count of array objects
  total_gc_roots: number;       // Count of GC root references
}
```

## ClassHistogramEntry

One row in the class histogram. Aggregates all instances of the same class.

```typescript
interface ClassHistogramEntry {
  class_name: string;      // Fully-qualified class name
  instance_count: number;  // Number of instances of this class
  shallow_size: number;    // Sum of shallow sizes of all instances
  retained_size: number;   // Sum of retained sizes of all instances
}
```

Sorted by `retained_size` descending.

## LeakSuspect

A detected memory leak candidate.

```typescript
interface LeakSuspect {
  class_name: string;           // Class name of the suspect
  object_id: number;            // HPROF object ID (0 for class-level suspects)
  retained_size: number;        // Bytes retained by this suspect
  retained_percentage: number;  // Percentage of reachable heap (e.g., 42.1)
  description: string;          // Human-readable explanation
  dependency?: {                // Present if class is from a known dependency
    groupId: string;            // Maven group ID
    artifactId: string;         // Maven artifact ID
    version: string;            // Dependency version
  };
}
```

## WasteAnalysis

Waste analysis results including duplicate strings and empty collections.

```typescript
interface WasteAnalysis {
  total_wasted_bytes: number;              // Combined waste
  waste_percentage: number;                // As percentage of total heap
  duplicate_string_wasted_bytes: number;   // Waste from duplicate strings
  empty_collection_wasted_bytes: number;   // Waste from empty collections
  duplicate_strings: DuplicateStringGroup[];
  empty_collections: EmptyCollectionGroup[];
}

interface DuplicateStringGroup {
  preview: string;       // First 120 characters of the string content
  count: number;         // Number of identical copies
  wasted_bytes: number;  // (count - 1) * per_copy_size
  total_bytes: number;   // count * per_copy_size
}

interface EmptyCollectionGroup {
  class_name: string;    // e.g., "java.util.HashMap"
  count: number;         // Number of empty instances
  wasted_bytes: number;  // Total shallow size of all empty instances
}
```

## AnalyzeHeapResult

The full notification payload sent by `heap_analysis_complete`.

```typescript
interface AnalyzeHeapResult {
  request_id: number;
  status: "completed" | "error";
  top_objects?: ObjectReport[];          // All objects sorted by retained size
  top_layers?: ObjectReport[];           // Filtered: no Class/SuperRoot, top 20
  summary?: HeapSummary;
  class_histogram?: ClassHistogramEntry[];
  leak_suspects?: LeakSuspect[];
  waste_analysis?: WasteAnalysis;
  error?: string;                        // Present only when status is "error"
}
```

## Type Mapping

The `node_type` field uses these values:

| Value | Description |
|-------|-------------|
| `"SuperRoot"` | Synthetic root (filtered from UI) |
| `"Root"` | GC root entry point |
| `"Class"` | Java class definition (filtered from most views) |
| `"Instance"` | Regular Java object instance |
| `"Array"` | Array object (object[] or primitive[]) |
