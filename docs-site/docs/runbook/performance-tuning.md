---
sidebar_position: 3
title: Performance Tuning
---

# Performance Tuning

Guidelines for analyzing large heap dumps and optimizing HeapLens's resource usage.

## System Requirements

| Heap Dump Size | Recommended RAM | Recommended Storage |
|---------------|----------------|-------------------|
| &lt; 100 MB | 4 GB | SSD preferred |
| 100 MB - 500 MB | 8 GB | SSD preferred |
| 500 MB - 2 GB | 16 GB | SSD required |
| > 2 GB | 32 GB | SSD required |

The Rust analysis server uses approximately **3-4x the HPROF file size** in peak memory during graph construction. This is temporary — after analysis completes, memory usage drops to ~1-2x for the cached state.

## Memory-Mapped I/O

HeapLens uses memory-mapped I/O to read HPROF files. The operating system loads pages on demand from the file into the page cache. This has implications:

- **First analysis is slower** — Pages are loaded from disk on first access
- **Repeat analysis is faster** — The OS page cache retains the file data
- **SSD matters** — Random page faults are fast on SSD, slow on HDD
- **Available RAM matters** — The OS may evict pages under memory pressure, causing re-reads

## Optimizations in the Analysis Engine

HeapLens includes several performance optimizations:

### Graph Building
- **Single-pass record scanning** — UTF8, LoadClass, and HeapDump records are scanned in one pass
- **Pre-sized data structures** — All major HashMaps use `with_capacity()` based on heuristics from the file size
- **Memoized inheritance chains** — Class field layouts resolved once and cached

### Dominator Computation
- **O(V+E) retained size computation** — Stack-based DFS post-order traversal instead of iterative fixpoint
- **Vec-indexed state** — `retained_sizes`, `shallow_sizes`, and `node_data_map` use `Vec<T>` indexed by `NodeIndex` for cache-friendly sequential access

### Memory Management
- **Arc-wrapped AnalysisState** — Cloning state references for concurrent access is a single atomic increment
- **String interning** — Class names use `Arc<str>` shared across all instances of the same class
- **Explicit drops** — Intermediate data structures (string table, class field info) are explicitly dropped after their last use

## Tips for Large Files

### Before Analysis

1. **Close unnecessary applications** to free RAM
2. **Ensure sufficient disk space** — Memory mapping may use swap if RAM is low
3. **Use SSD storage** for the HPROF file

### During Analysis

Monitor the `hprof-server` process:

```bash
# macOS
top -pid $(pgrep hprof-server)

# Linux
htop -p $(pgrep hprof-server)
```

Expected behavior:
- CPU usage: one core at 100% during graph building and dominator computation
- Memory usage: climbs to 3-4x file size, then stabilizes at 1-2x

### If Analysis Fails

- **SIGKILL (exit code 137)** — Out of memory. Close other applications or analyze on a machine with more RAM.
- **Timeout in VS Code** — The extension has a 30-second default timeout for RPC requests, but `analyze_heap` uses an async notification pattern that is not subject to this timeout. If the webview shows an error, check the Output channel for the actual error.
- **Corrupt file errors** — The HPROF file may be truncated. Re-capture the heap dump.

## Benchmarks

Approximate analysis times on a MacBook Pro (M1, 16 GB RAM):

| File | Size | Objects | Edges | Graph Build | Dominators | Total |
|------|------|---------|-------|-------------|------------|-------|
| Small service | 26 MB | 400K | 1.2M | 1.2s | 0.5s | 2.5s |
| Medium app | 212 MB | 3.1M | 12M | 12s | 4s | 18s |
| Large monolith | 1.1 GB | 14M | 58M | 55s | 18s | 80s |

These timings include all phases: file mapping, graph construction, dominator computation, leak detection, histogram, and waste analysis.
