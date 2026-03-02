---
sidebar_position: 3
title: Retained vs. Shallow Size
---

# Retained vs. Shallow Size

These two metrics appear in every tab of HeapLens. Understanding the difference is essential for interpreting heap analysis results.

## Shallow Size

**Shallow size** is the memory consumed by the object itself — its header and field data, nothing more.

Every Java object has:
- An **object header** (typically 12-16 bytes): stores the class pointer, hash code, and GC metadata
- **Field data**: the primitive values and reference pointers declared by the class

```java
class User {
    String name;      // 8 bytes (reference pointer)
    int age;          // 4 bytes
    boolean active;   // 1 byte (+3 padding for alignment)
}
// Shallow size ≈ 16 (header) + 16 (fields) = 32 bytes
```

The shallow size of a `User` is 32 bytes regardless of how long the `name` string is. The `String` object and its backing `char[]` are separate objects with their own shallow sizes.

### Array Shallow Sizes

Arrays include the header plus the element data:

```
byte[1000]  → 16 (header) + 1000 (data) + padding = ~1016 bytes
int[1000]   → 16 (header) + 4000 (data) = 4016 bytes
Object[100] → 16 (header) + 800 (100 × 8-byte refs) = 816 bytes
```

## Retained Size

**Retained size** is the total memory that would be freed if this object were garbage collected. It includes the object's shallow size plus the shallow sizes of all objects that are *only* reachable through this object.

This is computed from the [Dominator Tree](./dominator-tree): a node's retained size equals its shallow size plus the sum of retained sizes of all its children in the dominator tree.

### Example

```
HashMap (shallow: 48 bytes)
  └─ Node[] (shallow: 8016 bytes)
       ├─ Node (shallow: 32 bytes)
       │    ├─ String "key1" (shallow: 24 bytes)
       │    │    └─ byte[] (shallow: 56 bytes)
       │    └─ BigObject (shallow: 64 bytes)
       │         └─ byte[1MB] (shallow: 1,048,592 bytes)
       └─ ... (more nodes)
```

| Object | Shallow Size | Retained Size |
|--------|-------------|---------------|
| `byte[1MB]` | 1,048,592 | 1,048,592 (leaf node, no children) |
| `BigObject` | 64 | 1,048,656 (64 + 1,048,592) |
| `String "key1"` | 24 | 80 (24 + 56) |
| `Node` | 32 | 1,048,768 (32 + 80 + 1,048,656) |
| `Node[]` | 8,016 | 1,056,784+ (8,016 + all nodes) |
| `HashMap` | 48 | 1,056,832+ (48 + entire tree below) |

The HashMap's shallow size is only 48 bytes. But its retained size could be gigabytes — because collecting the HashMap would also collect its entire backing array, every entry, every key, and every value.

## How HeapLens Computes Retained Sizes

HeapLens uses a single-pass bottom-up traversal of the dominator tree:

1. **Initialize** every node's retained size to its shallow size
2. Process nodes from leaves to root (reverse topological order)
3. For each node: `retained_size += sum(child.retained_size for each child in dominator tree)`

This is O(V) — linear in the number of objects. For a 200 MB heap dump with 3 million objects, this completes in under a second.

## Interpreting the Numbers

| Scenario | What it tells you |
|---------|-------------------|
| High retained, low shallow | The object is a "gatekeeper" — it keeps a large subgraph alive through its references |
| High retained, high shallow | The object is large itself *and* keeps other objects alive (e.g., a big byte[] that is the sole content of a cache entry) |
| High shallow, low retained | The object is large but others also reference its children — removing it alone wouldn't free much |
| Many objects with small retained | Distributed memory — no single bottleneck, may indicate a class-level issue (see Histogram) |

## Shared References and the Dominator Boundary

If two objects both reference a third, that third object is *not* in the retained set of either one — it's retained by their common dominator (further up the tree).

```
    Controller
    ├─→ ServiceA ─→ SharedConfig
    └─→ ServiceB ─→ SharedConfig
```

`SharedConfig` is retained by `Controller` (their common dominator), not by `ServiceA` or `ServiceB`. Neither service's retained size includes `SharedConfig`. This is correct — collecting `ServiceA` alone would not free `SharedConfig` because `ServiceB` still references it.

This is why retained sizes sometimes look smaller than expected — shared objects are attributed to the closest common ancestor in the dominator tree.
