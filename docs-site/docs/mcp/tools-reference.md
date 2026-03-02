---
sidebar_position: 3
title: Tools Reference
---

# MCP Tools Reference

HeapLens exposes six tools through the MCP protocol. All tools return markdown-formatted text optimized for LLM consumption.

## analyze_heap

Full analysis of a Java heap dump. **Must be called before any other tool.**

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `path` | string | Yes | Absolute path to the `.hprof` file |

### Response

Returns a comprehensive markdown report including:
- Heap summary (total size, object counts)
- Top 20 objects by retained size (table)
- Leak suspects (if any detected)
- Top 10 classes by retained size (table)
- Waste analysis summary (if waste detected)

### Example

**Input:**
```json
{ "path": "/tmp/heap.hprof" }
```

**Output (abbreviated):**
```markdown
## Heap Summary

- **Total Heap Size:** 212.00 MB
- **Objects:** 2,847,312
- **Classes:** 8,421
- **Arrays:** 612,455
- **GC Roots:** 3,847

## Top Objects by Retained Size

| # | Class | Type | Shallow | Retained |
|---|-------|------|---------|----------|
| 1 | com.example.cache.DataCache | Instance | 48 B | 512.30 MB |
| 2 | java.util.HashMap | Instance | 48 B | 245.10 MB |
...

## Leak Suspects

- **[HIGH] com.example.cache.DataCache** - retains 31.4% of heap (512.30 MB)
  Single DataCache instance retains 31.4% of reachable heap

## Waste Analysis

- **Total Waste:** 45.20 MB (8.8% of heap)
- **Duplicate Strings:** 35.60 MB
- **Empty Collections:** 9.60 MB
```

---

## get_leak_suspects

Returns detected memory leak suspects from a previously analyzed heap dump.

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `path` | string | Yes | Absolute path to the `.hprof` file (must have been analyzed first) |

### Response

Detailed leak suspect report with severity, class name, retained size, percentage, and description for each suspect. If no suspects detected, returns a message stating so.

### Example Output

```markdown
## Leak Suspects

### 1. [HIGH] com.example.cache.DataCache

- **Retained:** 512.30 MB (31.4% of heap)
- **Object ID:** 123456 (use `drill_down` to explore)
- **Description:** Single DataCache instance retains 31.4% of reachable heap

### 2. [MEDIUM] com.example.model.UserSession

- **Retained:** 185.00 MB (11.3% of heap)
- **Description:** 45,000 instances of UserSession collectively retain 11.3% of reachable heap
```

---

## get_class_histogram

Returns class-level memory aggregation.

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `path` | string | Yes | Absolute path to the `.hprof` file |
| `limit` | integer | No | Maximum number of entries (default: 30) |

### Example Output

```markdown
## Class Histogram (top 30 of 8421)

| # | Class | Instances | Shallow | Retained |
|---|-------|-----------|---------|----------|
| 1 | byte[] | 1,245,678 | 890.20 MB | 890.20 MB |
| 2 | java.lang.String | 845,312 | 32.20 MB | 142.50 MB |
| 3 | java.util.HashMap$Node | 612,000 | 23.40 MB | 580.00 MB |
...
```

---

## drill_down

Explore the dominator tree children of a specific object. Use this to investigate what an object retains.

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `path` | string | Yes | Absolute path to the `.hprof` file |
| `object_id` | integer | Yes | Object ID from previous `analyze_heap` or `drill_down` results |

### Example Output

```markdown
## Children of Object 123456 (5 entries)

| # | Class | Type | Object ID | Shallow | Retained |
|---|-------|------|-----------|---------|----------|
| 1 | java.util.HashMap | Instance | 234567 | 48 B | 510.20 MB |
| 2 | java.lang.String | Instance | 345678 | 24 B | 2.10 MB |
| 3 | int[] | Array | 456789 | 128 B | 128 B |

Use `drill_down` with any object_id above to explore deeper.
```

---

## get_summary

Returns heap summary statistics.

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `path` | string | Yes | Absolute path to the `.hprof` file |

### Example Output

```markdown
## Heap Summary

- **Total Heap Size:** 212.00 MB
- **Reachable Heap Size:** 163.50 MB
- **Total Objects (instances):** 2,847,312
- **Total Classes:** 8,421
- **Total Arrays:** 612,455
- **GC Roots:** 3,847
```

---

## get_waste_analysis

Returns waste analysis showing duplicate strings and empty collections.

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `path` | string | Yes | Absolute path to the `.hprof` file |

### Example Output

```markdown
## Waste Analysis

- **Total Waste:** 45.20 MB (8.8% of heap)
- **Duplicate Strings:** 35.60 MB
- **Empty Collections:** 9.60 MB

### Duplicate Strings (top 20 of 1,245)

| # | Preview | Copies | Wasted | Total |
|---|---------|--------|--------|-------|
| 1 | "" | 45,000 | 1.80 MB | 1.80 MB |
| 2 | "application/json" | 8,200 | 820 KB | 920 KB |
| 3 | "UTF-8" | 6,100 | 390 KB | 454 KB |
...

### Empty Collections (3 types)

| Class | Count | Wasted |
|-------|-------|--------|
| java.util.HashMap | 120,000 | 5.70 MB |
| java.util.ArrayList | 85,000 | 3.40 MB |
| java.util.LinkedHashMap | 12,000 | 672 KB |
```

---

## Tool Calling Patterns

### Basic Analysis Flow

```
1. analyze_heap(path)           → full summary
2. get_leak_suspects(path)      → detailed leak report
3. drill_down(path, object_id)  → explore specific suspect
4. drill_down(path, child_id)   → go deeper
```

### Waste-Focused Analysis

```
1. analyze_heap(path)           → includes waste summary
2. get_waste_analysis(path)     → detailed waste breakdown
```

### Targeted Investigation

```
1. analyze_heap(path)           → identify suspects
2. get_class_histogram(path, limit=50)  → find unusual class counts
3. drill_down(path, suspect_id) → explore suspect's retention
```
