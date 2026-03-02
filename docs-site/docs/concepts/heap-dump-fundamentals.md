---
sidebar_position: 1
title: Heap Dump Fundamentals
---

# Heap Dump Fundamentals

A heap dump is a snapshot of every object alive in a Java Virtual Machine at a single point in time. It captures what objects exist, how much memory each uses, and how they reference each other. HeapLens parses this snapshot and builds a model you can explore interactively.

## What's Inside a Heap Dump

When the JVM writes an HPROF file, it records four categories of data:

### 1. Objects (Instances)

Every Java object on the heap is dumped with:
- Its **object ID** (a unique address)
- Its **class** (which class this is an instance of)
- Its **field values** (primitives stored inline, references stored as IDs pointing to other objects)

For example, a `HashMap` instance stores its `size` field (an int), its `table` field (a reference to a `Node[]` array), and its `loadFactor` (a float).

### 2. Arrays

Both object arrays (`String[]`, `Node[]`) and primitive arrays (`byte[]`, `int[]`) are recorded. Object arrays store a list of references to other objects. Primitive arrays store raw values.

### 3. Classes

Each loaded class is dumped with its:
- Class name and superclass
- Static fields (these are roots — they keep objects alive across the entire application)
- Instance field descriptors (names and types, used to correctly parse instance data)

### 4. GC Roots

GC roots are the starting points for reachability analysis. An object is "alive" if and only if there is a reference chain from at least one GC root to that object. Common GC root types:

| Root Type | Source |
|-----------|--------|
| System Class | Bootstrap classloader classes (`java.lang.String`, `java.util.HashMap`, etc.) |
| JNI Global | Native code holding a global reference |
| Thread | Active thread objects and their stack frames |
| Java Stack Frame | Local variables on active method stacks |
| Monitor | Objects currently used as synchronization locks |

## The Object Graph

All these references form a **directed graph**:

```
GC Root (Thread)
  └─→ Controller
        ├─→ UserService
        │     └─→ HashMap (user cache)
        │           ├─→ Node[] (table)
        │           │     ├─→ Node → "alice" → User(...)
        │           │     └─→ Node → "bob"   → User(...)
        │           └─→ ...
        └─→ Logger
              └─→ ArrayList (handlers)
```

Every arrow is a reference — one object holding a pointer to another. If you cut the arrow from `Controller` to `UserService`, everything below it (the HashMap, its entries, the User objects) becomes unreachable and eligible for garbage collection.

This graph is the foundation of all HeapLens analysis. The [Dominator Tree](./dominator-tree) simplifies this graph into a hierarchy of ownership. The [Retained vs. Shallow Size](./retained-vs-shallow-size) concepts tell you how much memory each node in that hierarchy controls.

## Why Heap Dumps Matter

Heap dumps answer questions that profilers, metrics, and logs cannot:

- **"Why is my service using 4 GB when it should use 500 MB?"** — The heap dump shows exactly which objects exist and what holds them alive.
- **"Where is the memory leak?"** — Leak detection algorithms find objects retaining disproportionate memory.
- **"What's wasting memory?"** — Waste analysis identifies duplicate strings, empty collections, and oversized buffers that can be reduced without code changes.

They are a snapshot, not a timeline. They tell you *what is*, not *how it got there*. For that reason, heap dumps pair well with flight recordings (JFR) or allocation profilers that show *where* objects were created.
