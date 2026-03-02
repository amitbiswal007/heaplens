---
sidebar_position: 6
title: Waste Analysis
---

# Waste Analysis

Waste analysis identifies memory that is consumed by redundant or unnecessary objects — memory that can often be reduced **without changing application logic**. This is distinct from leak detection, which finds objects that should not exist at all.

## Two Categories of Waste

### 1. Duplicate Strings

Java's `String` objects are immutable but not automatically interned (except for compile-time constants). This means identical string content is frequently stored in multiple separate `String` instances, each with its own backing `byte[]` or `char[]` array.

In typical enterprise applications, **10-30% of heap** is consumed by strings, and **30-60% of those** are duplicates.

**How HeapLens detects them:**

1. During HPROF parsing (Pass 2), identify all `java.lang.String` instances
2. For each String, extract the reference to its backing array (`value` field)
3. For each backing `byte[]` or `char[]` array, compute a content hash (SipHash)
4. Group strings by content hash
5. For groups with count > 1: `wasted_bytes = (count - 1) × (string_shallow_size + array_size)`

**Example findings:**

| String Content | Copies | Wasted |
|---------------|--------|--------|
| `"application/json"` | 8,200 | 820 KB |
| `"UTF-8"` | 6,100 | 390 KB |
| `"true"` | 14,500 | 580 KB |
| `"SELECT * FROM users WHERE id = ?"` | 2,300 | 230 KB |
| `""` (empty string) | 45,000 | 1.8 MB |

**How to fix duplicate strings:**

- **`String.intern()`** — JVM deduplicates at runtime, but has a global lock and populates the string pool forever. Use sparingly.
- **`-XX:+UseStringDeduplication`** — JVM flag (G1 GC only, JDK 8u20+) that deduplicates during GC with no code changes. Low overhead.
- **Application-level constants** — Replace repeated literals with `static final` fields.
- **Caching / flyweight pattern** — For values like HTTP headers, status codes, or enum-like strings, use a shared instance.

### 2. Empty Collections

Java collection classes allocate internal storage eagerly. An empty `HashMap` consumes **48 bytes** (the object itself) plus potentially a **64-byte** backing `Node[]` array — 112 bytes total for zero stored entries.

In applications that pre-allocate data structures defensively (`new HashMap<>()` in every constructor, even if rarely populated), this adds up.

**How HeapLens detects them:**

1. Identify instances of `java.util.HashMap`, `java.util.ArrayList`, and `java.util.LinkedHashMap`
2. For each instance, read the `size` field using the class field descriptor
3. If `size == 0`, record it as an empty collection
4. Aggregate by class name: total count and total shallow bytes wasted

**Why positional field extraction works:** The `size` field is the first `int` field in the inheritance chain for all three collection types. `HashMap.size`, `ArrayList.size`, and `LinkedHashMap` (which inherits from `HashMap`) all have `size` as their first integer field. This holds across JDK 8-21.

**Example findings:**

| Collection Class | Empty Count | Wasted |
|-----------------|-------------|--------|
| `java.util.HashMap` | 120,000 | 5.7 MB |
| `java.util.ArrayList` | 85,000 | 3.4 MB |
| `java.util.LinkedHashMap` | 12,000 | 672 KB |

**How to fix empty collections:**

- **Lazy initialization** — Don't allocate the collection until the first element is added:
  ```java
  // Before (wasteful if rarely used)
  private Map<String, String> metadata = new HashMap<>();

  // After (allocate on first use)
  private Map<String, String> metadata;

  public void addMeta(String k, String v) {
      if (metadata == null) metadata = new HashMap<>();
      metadata.put(k, v);
  }
  ```
- **`Collections.emptyMap()` / `Collections.emptyList()`** — Singleton instances for read-only empty collections.
- **`Map.of()` / `List.of()` (JDK 9+)** — Immutable factories that return shared empty instances for zero-element calls.

## Waste Summary Metrics

HeapLens computes aggregate waste metrics:

```
Total Waste:            45.2 MB (8.8% of heap)
├─ Duplicate Strings:   35.6 MB
└─ Empty Collections:    9.6 MB
```

The waste percentage is relative to `total_heap_size`, giving you a quick read on how much memory is recoverable without logic changes.

## Limitations

- **Preview truncation:** String previews are limited to 120 characters. Very long strings (e.g., serialized JSON) show a truncated preview.
- **Large array skip:** Arrays larger than 10 KB skip preview generation (they are still hashed and counted).
- **Collection types covered:** Currently detects empty `HashMap`, `ArrayList`, and `LinkedHashMap`. Other collection types (`HashSet`, `TreeMap`, `ConcurrentHashMap`) are not yet covered.
- **Not detected:** Oversized collections (capacity >> size, e.g., a `HashMap` with initial capacity 10,000 but only 3 entries) are a future enhancement.
