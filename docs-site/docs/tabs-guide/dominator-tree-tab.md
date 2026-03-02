---
sidebar_position: 3
title: Dominator Tree Tab
---

# Dominator Tree Tab

The Dominator Tree tab is the primary investigation tool in HeapLens. It shows the heap as a hierarchy of ownership — expand any node to see what it retains, and keep drilling until you find the root cause of a memory issue.

## What You See

An expandable tree view starting from the top-level objects (those directly dominated by the SuperRoot):

```
▶ com.example.cache.DataCache           Instance   48 B     512.30 MB  ████████████  31.4%
▶ java.util.concurrent.ConcurrentHashMap Instance  48 B     245.10 MB  ██████        15.0%
▶ com.example.service.AuditLog          Instance   32 B     142.50 MB  ████          8.7%
▶ byte[]                                Array      1.02 MB  1.02 MB    ▏             0.1%
```

### Column Layout

| Element | Meaning |
|---------|---------|
| **▶ / ▼** | Expansion triangle — click to load children |
| **Class Name** | The fully-qualified class name of the object |
| **Type badge** | `Instance` or `Array` |
| **Shallow** | The object's own memory |
| **Retained** | Total memory in this object's dominator subtree |
| **Bar** | Visual bar proportional to retained size as percentage of total heap |
| **Percentage** | Retained size as percentage of reachable heap |

## Interactions

### Expanding Nodes

Click the **▶** triangle to fetch and display children. This sends a `get_children` request to the Rust backend, which returns the object's immediate children in the dominator tree.

Children are sorted by retained size (largest first), and Class nodes and zero-size entries are filtered out.

```
▼ com.example.cache.DataCache           Instance   48 B     512.30 MB  31.4%
    ▶ java.util.HashMap                 Instance   48 B     510.20 MB  31.2%
    ▶ java.lang.String                  Instance   24 B     2.10 MB    0.1%
```

Expand further:

```
▼ com.example.cache.DataCache           Instance   48 B     512.30 MB  31.4%
  ▼ java.util.HashMap                   Instance   48 B     510.20 MB  31.2%
      ▶ java.util.HashMap$Node[]        Array      4.02 MB  508.00 MB  31.1%
      ▶ java.util.Set                   Instance   16 B     2.20 MB    0.1%
```

### GC Root Path

Click the **pin icon** on any tree node (or right-click → GC Root Path) to show the shortest reference chain from GC roots to that object. A breadcrumb trail appears above the tree:

```
Thread "main" → StaticField AppContext.instance → DataCache → HashMap
```

This answers "why is this object alive?" — essential for confirming a leak.

### Back to Root

Click "Back to Root" to reset the tree to the top-level view.

## How to Read the Tree

The dominator tree reads top-down as a chain of ownership:

```
SessionManager (retains 850 MB)
  └─ ConcurrentHashMap (retains 848 MB)
      └─ Node[] (retains 846 MB)
          ├─ Session #1 (retains 4.2 MB)
          │   ├─ User (retains 2.1 MB)
          │   │   ├─ String "alice" (retains 80 B)
          │   │   └─ byte[] (retains 1.9 MB)  ← profile photo?
          │   └─ ShoppingCart (retains 1.8 MB)
          ├─ Session #2 (retains 3.9 MB)
          └─ ... (200,000 more sessions)
```

**Reading rules:**
- Each child is **exclusively retained** by its parent — if the parent is garbage collected, so are all its children
- Retained sizes add up: parent's retained = parent's shallow + sum of children's retained
- If a node has many children of similar size, you have a **collection** (the fan-out point)
- If one child has nearly the same retained size as the parent, the parent is a **pass-through** — the child is the real owner

## Investigation Patterns

### Pattern 1: Find the Fan-Out Point

Keep expanding the largest child at each level until you hit a node with many children of similar size. That is the collection holding the leaked objects.

```
Level 1: DataCache (512 MB) ← suspect
Level 2: HashMap (510 MB)   ← infrastructure, keep going
Level 3: Node[] (508 MB)    ← infrastructure, keep going
Level 4: 100,000 entries    ← FAN-OUT POINT — 100K cached items
```

**Diagnosis:** The cache has 100,000 entries. Check if there's a TTL or maximum size configured.

### Pattern 2: Identify Object Types at the Fan-Out

Once you find the fan-out, look at the children's class names:

```
Node[] (508 MB)
  ├─ HashMap$Node → com.example.model.Order (5.2 MB)
  ├─ HashMap$Node → com.example.model.Order (4.8 MB)
  └─ ... (100,000 Orders)
```

The cache is storing `Order` objects. Search your codebase for where `Order` instances are added to a `DataCache`.

### Pattern 3: Compare Shallow vs. Retained at Each Level

```
com.example.Connection (retains 45 MB)
  └─ java.io.BufferedOutputStream (retains 44.9 MB)
      └─ byte[] (shallow: 44.9 MB, retained: 44.9 MB)
```

The `Connection` retains 45 MB, but virtually all of it is a single `byte[]` buffer inside a `BufferedOutputStream`. The connection was closed but never flushed, leaving a massive unflushed buffer alive.

## Example Walkthrough

**Scenario:** Your application's heap is 1.5 GB when it should be 300 MB.

**Step 1:** Open the Dominator Tree tab. The top entry is:

```
▶ c.e.messaging.MessageBroker   Instance   64 B    1.12 GB   74.6%
```

**Step 2:** Expand it:

```
▼ c.e.messaging.MessageBroker   Instance   64 B    1.12 GB   74.6%
    ▶ java.util.ArrayDeque       Instance   48 B    1.12 GB   74.5%
```

**Step 3:** An `ArrayDeque` retaining 1.12 GB. Expand further:

```
▼ java.util.ArrayDeque           Instance   48 B    1.12 GB
    ▶ java.lang.Object[]         Array      8 MB    1.11 GB
```

**Step 4:** Expand the Object[]:

```
▼ java.lang.Object[]             Array      8 MB    1.11 GB
    ▶ c.e.messaging.Message      Instance   48 B    2.2 MB
    ▶ c.e.messaging.Message      Instance   48 B    2.1 MB
    ▶ c.e.messaging.Message      Instance   48 B    2.0 MB
    ... (500,000+ entries)
```

**Diagnosis:** The `MessageBroker` has an `ArrayDeque` with 500,000+ unprocessed messages, each ~2 MB. Messages are being enqueued faster than they are consumed, or the consumer is stuck.

**Action:** Add backpressure (bounded queue), fix the consumer, or add a drain mechanism.
