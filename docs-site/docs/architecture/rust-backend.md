---
sidebar_position: 2
title: Rust Backend
---

# Rust Backend

The Rust backend (`hprof-server`) is a standalone binary that parses HPROF files and computes all analysis results. It is the computational core of HeapLens.

## Crate Structure

```
hprof-analyzer/
├── Cargo.toml        # Dependencies: jvm-hprof, petgraph, memmap2, tokio, serde, clap
├── src/
│   ├── lib.rs        # Core analysis engine (parsing, graph, dominators, leak detection)
│   └── main.rs       # Server (JSON-RPC + MCP modes, request routing, state management)
```

The library (`lib.rs`) and the server (`main.rs`) are cleanly separated. The library exposes pure functions that take byte slices and return data structures. The server handles I/O, concurrency, and state management.

## Key Dependencies

| Crate | Version | Purpose |
|-------|---------|---------|
| `jvm-hprof` | 0.1 | HPROF binary format parser with zero-copy access |
| `petgraph` | 0.6 | Graph data structure and Lengauer-Tarjan dominator algorithm |
| `memmap2` | 0.9 | Memory-mapped file I/O |
| `tokio` | 1.x | Async runtime (stdin/stdout I/O, blocking task pool) |
| `serde` / `serde_json` | 1.x | JSON serialization for RPC responses |
| `clap` | 4.x | CLI argument parsing (`--mcp` flag) |
| `anyhow` | 1.x | Error handling with context |

## Analysis Pipeline

The analysis runs in four stages:

### Stage 1: File Loading

```rust
let loader = HprofLoader::new(path);
let mmap = loader.map_file()?;
```

The file is memory-mapped (read-only). No data is copied — all subsequent parsing reads directly from the OS page cache.

### Stage 2: Graph Building (`build_graph`)

A two-pass scan of the HPROF records:

**Pass 1 — Node creation:**
- Scans UTF8, LoadClass, and HeapDump records in a single pass
- Builds the string table (UTF8 record ID → string content)
- Builds the class name map (class object ID → fully-qualified class name)
- Collects class instance sizes and field descriptors
- Creates graph nodes for every instance, array, class, and GC root

**Pass 2 — Edge creation + waste data collection:**
- For each instance: reads field data using class field descriptors, extracts object references as edges
- For each object array: reads element IDs as edges
- For each class: extracts superclass, classloader, and static field references as edges
- Connects all GC roots to a synthetic SuperRoot node
- **Waste collection:** Identifies String instances (extracts `value` array reference), empty collections (reads `size` field), and hashes backing `byte[]`/`char[]` arrays

**Output:** A `HeapGraph` (petgraph directed graph) and `WasteRawData` (intermediate waste data).

### Stage 3: Dominator Analysis (`calculate_dominators_with_state`)

1. **Dominator tree** — Runs Lengauer-Tarjan via `petgraph::algo::dominators::simple_fast`
2. **Children map** — Builds a map from each node to its children in the dominator tree
3. **Retained sizes** — Bottom-up traversal: `retained[node] = shallow[node] + sum(retained[child])`
4. **Leak detection** — Four-phase algorithm (classloader suspects → accumulation points → individual suspects → class aggregates)
5. **Histogram** — Aggregates instances by class name (count, shallow total, retained total)
6. **Waste analysis** — Groups duplicate strings by content hash, aggregates empty collections by class
7. **Reverse references** — Builds a reverse adjacency map for GC root path queries

**Output:** `AnalysisState` containing all computed results, cached for subsequent queries.

### Stage 4: State Caching

The `AnalysisState` is wrapped in `Arc<AnalysisState>` and stored in a `HashMap<PathBuf, FileAnalysisState>`. Subsequent requests (`get_children`, `gc_root_path`, etc.) read from this cache without recomputation.

## Field Descriptor Resolution

Accurately extracting references from instance field data requires knowing which bytes are references and which are primitive values. HeapLens resolves this using class field descriptors:

1. Class sub-records in the HPROF contain field descriptors (name, type) for each class
2. For each class, the full field layout is resolved by walking the inheritance chain (child fields first, then parent)
3. The layout is cached in `class_field_layouts: HashMap<u64, Vec<FieldType>>`
4. During instance edge extraction, the layout is used to read only ObjectId fields as references, skipping primitives by their byte sizes

This eliminates false edges that occur when primitive values (ints, longs) happen to match valid object IDs.

## Performance Characteristics

### Memory Usage

| Stage | Memory | Notes |
|-------|--------|-------|
| File mapping | ~0 | OS page cache, not heap allocation |
| Graph building | ~2-3x file size | Nodes, edges, hash maps |
| Dominator computation | ~1.5x node count | Dominator tree + retained sizes |
| State caching | ~1x graph | Retained for query serving |
| Peak | ~3-4x file size | During graph building |

### Timing (approximate, single-threaded)

| File Size | Nodes | Graph Build | Dominators | Total |
|-----------|-------|-------------|------------|-------|
| 26 MB | 400K | 1-2s | &lt;1s | ~3s |
| 200 MB | 3M | 8-15s | 3-5s | ~20s |
| 1 GB | 15M | 40-60s | 15-20s | ~80s |

## Data Structures

### HeapGraph

```rust
pub struct HeapGraph {
    graph: Graph<(u64, Arc<str>), (), Directed>,  // (object_id, class_name) per node
    id_to_node: HashMap<u64, NodeIndex>,
    super_root: NodeIndex,
    summary: HeapSummary,
    classloader_ids: HashSet<u64>,
}
```

### AnalysisState

```rust
pub struct AnalysisState {
    children_map: HashMap<NodeIndex, Vec<NodeIndex>>,
    retained_sizes: Vec<u64>,          // indexed by NodeIndex
    shallow_sizes: Vec<u64>,           // indexed by NodeIndex
    node_data_map: Vec<(u64, &'static str, Arc<str>)>,  // (id, type, class_name)
    id_to_node: HashMap<u64, NodeIndex>,
    super_root: NodeIndex,
    summary: HeapSummary,
    class_histogram: Vec<ClassHistogramEntry>,
    leak_suspects: Vec<LeakSuspect>,
    waste_analysis: WasteAnalysis,
    reverse_refs: HashMap<NodeIndex, Vec<NodeIndex>>,
}
```

The `retained_sizes`, `shallow_sizes`, and `node_data_map` use `Vec<T>` indexed by `NodeIndex` (converted to `usize`) for cache-friendly O(1) access, rather than `HashMap<NodeIndex, T>`.

## Error Handling

All errors use `anyhow::Result` with context chains:

```rust
let mmap = loader.map_file()
    .with_context(|| format!("Failed to load HPROF file: {:?}", path))?;
```

Errors propagate to the server layer, which returns them as JSON-RPC error responses or MCP error results.
