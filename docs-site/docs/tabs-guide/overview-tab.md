---
sidebar_position: 1
title: Overview Tab
---

# Overview Tab

The Overview tab is the first thing you see after analysis completes. It provides a high-level summary of the heap and highlights the largest memory consumers.

## What You See

### Stat Cards

A row of key metrics at the top:

| Metric | Meaning | Example Value |
|--------|---------|---------------|
| **Reachable Heap Size** | Memory held by objects reachable from GC roots | 163.50 MB |
| **Total Heap Size** | All objects in the dump, including unreachable garbage | 212.00 MB |
| **Objects** | Total instance count | 2,847,312 |
| **Classes** | Loaded class count | 8,421 |
| **Arrays** | Array object count (both object[] and primitive[]) | 612,455 |
| **GC Roots** | Number of garbage collection root references | 3,847 |

**Reading the numbers:** If "Reachable Heap" is much smaller than "Total Heap," the JVM had pending garbage when the dump was taken. Focus on the reachable number — that is what your application is actually using.

### Top Objects Table

A table of the 10 largest objects sorted by retained size:

```
 #  Class                              Type      Shallow    Retained
 1  com.example.cache.DataCache        Instance  48 B       512.30 MB
 2  java.util.HashMap                  Instance  48 B       245.10 MB
 3  byte[]                             Array     1.02 MB    1.02 MB
 4  com.example.model.UserSession      Instance  64 B       890.40 KB
 ...
```

**How to read this:**
- **Shallow vs. Retained gap** — `DataCache` has a 48-byte shallow size but retains 512 MB. This means it holds references to a massive subgraph of objects. It's a "gatekeeper."
- **byte[] at #3** — When a `byte[]` array has equal shallow and retained size, it's a leaf node holding raw data. Its parent in the dominator tree is the real memory holder.
- **Sorted by Retained** — The table is sorted by retained size. The first entry is the object responsible for the most memory.

### Pie Chart

An interactive D3.js pie chart showing how the top objects divide the heap by retained size. Hover over any slice to see:

```
com.example.cache.DataCache
Retained: 512.30 MB (31.4%)
```

The chart gives you an instant visual answer to "where is my memory going?" If one slice dominates, that's your investigation target.

## Example Walkthrough

Suppose you open a heap dump from a Spring Boot service that is using 2 GB of heap when it should use 500 MB.

**Stat cards show:**
- Reachable Heap: 1.82 GB
- Objects: 12.4 million
- GC Roots: 5,200

**Top objects table shows:**

| # | Class | Retained |
|---|-------|----------|
| 1 | `c.e.audit.AuditLogBuffer` | 1.45 GB |
| 2 | `java.util.ArrayList` | 1.44 GB |
| 3 | `byte[]` | 12.8 MB |

**Interpretation:** A single `AuditLogBuffer` retains 1.45 GB — nearly 80% of the heap. The `ArrayList` at #2 is almost certainly the backing list *inside* the `AuditLogBuffer`. The audit log is unbounded and never flushed.

**Next step:** Switch to the [Dominator Tree tab](./dominator-tree-tab) and expand `AuditLogBuffer` to confirm the retention chain. Then check the [Leak Suspects tab](./leak-suspects-tab) — it should flag this automatically.
