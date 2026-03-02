---
sidebar_position: 4
title: Leak Suspects Tab
---

# Leak Suspects Tab

The Leak Suspects tab displays automatically detected objects and classes that retain a disproportionate share of the heap. It is the fastest way to identify likely memory leaks without manually exploring the dominator tree.

## What You See

A card layout where each card represents one suspect:

```
┌─────────────────────────────────────────────────────────────┐
│  HIGH   com.example.cache.SessionCache                       │
│                                                               │
│  Retains 42.1% of heap (512.00 MB)                          │
│  Single SessionCache instance retains 42.1% of reachable    │
│  heap. Memory accumulated in HashMap (508.00 MB)             │
│  containing 45,000 entries.                                   │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  MEDIUM  com.example.model.AuditEntry                        │
│                                                               │
│  Retains 15.2% of heap (185.00 MB)                          │
│  250,000 instances of AuditEntry collectively retain         │
│  15.2% of reachable heap.                                     │
└─────────────────────────────────────────────────────────────┘
```

### Card Fields

| Field | Description |
|-------|-------------|
| **Severity badge** | `HIGH` (>30% of heap, red) or `MEDIUM` (5-30%, orange) |
| **Class name** | The suspected class or classloader |
| **Percentage** | Retained size as percentage of reachable heap |
| **Retained size** | Absolute memory in bytes |
| **Description** | Human-readable explanation of why this is a suspect |

### Empty State

If no objects exceed the detection threshold:

> No leak suspects detected. No single object or class retains more than 5% of the heap.

This typically means memory is well-distributed — no single bottleneck.

## Understanding the Descriptions

HeapLens generates different descriptions based on which detection phase flagged the suspect (see [Leak Detection Algorithm](../concepts/leak-detection)):

### Classloader Suspect (Phase 1)

> **Classloader org.apache.catalina.loader.WebappClassLoader retains 68.2% of reachable heap (1.36 GB). Memory accumulated in HashMap (1.32 GB) containing 650 entries.**

**What this means:** A web application classloader is keeping an entire component alive. This typically happens when a web app is redeployed but the old classloader is not garbage collected.

**What to investigate:** Look for common classloader leak causes — `ThreadLocal` not cleaned up, `DriverManager` registrations, shutdown hooks, `java.beans.Introspector` caches.

### Individual Object Suspect (Phase 3)

> **Single ConcurrentHashMap instance retains 12.3% of reachable heap (246 MB).**

**What this means:** One specific `ConcurrentHashMap` object is holding 246 MB. It's not a classloader issue — it's a single data structure that has grown too large.

**What to investigate:** Find this map in the Dominator Tree, expand it, and see what's stored inside. Check for missing eviction logic, unbounded cache, or retained query results.

### Class-Level Suspect (Phase 4)

> **45,000 instances of com.example.model.UserSession collectively retain 15.2% of reachable heap (304 MB).**

**What this means:** No single `UserSession` is huge, but 45,000 of them collectively consume 15% of the heap. This is a class-level aggregation issue.

**What to investigate:** Is 45,000 sessions expected? If the application serves 100 concurrent users, 45,000 sessions suggests expired sessions are not being cleaned up.

## How to Act on Leak Suspects

### Step 1: Confirm the Suspect

Switch to the **Dominator Tree** tab and find the suspect object. Expand it to see the retention chain:

```
SessionCache (512 MB)
  └─ HashMap (508 MB)
      └─ Node[] (506 MB)
          ├─ Session "abc123" (4.2 MB)
          │   └─ User + ShoppingCart + ...
          └─ ... (45,000 sessions)
```

### Step 2: Find the GC Root Path

Click the pin icon on the suspect to see why it's alive:

```
Thread "main" → StaticField AppConfig.cache → SessionCache
```

A static field — the cache is global and lives forever.

### Step 3: Check the Code

Search your codebase for where sessions are added to the cache and whether they are ever removed:

```java
// Found in SessionManager.java
cache.put(sessionId, session);  // Always adds

// Missing: cache.remove() or TTL-based expiration
```

### Step 4: Apply the Fix

Common fixes by suspect type:

| Suspect Type | Fix |
|-------------|-----|
| Unbounded cache | Add max size + eviction (LRU, TTL) |
| Thread-local leak | Call `.remove()` in a `finally` block |
| Classloader leak | Fix shutdown hooks, clear thread-locals on undeploy |
| Unclosed resources | Add `try-with-resources` or explicit `.close()` |
| Listener leak | Implement `unsubscribe()` / `removeListener()` |

## Example Walkthrough

**Scenario:** Production alert — Java service OOM after 3 days of uptime.

**Leak Suspects tab shows:**

```
HIGH   c.e.telemetry.MetricBuffer     — 52.3% of heap (1.05 GB)
       Single MetricBuffer instance retains 52.3% of reachable heap.

MEDIUM c.e.http.ConnectionPool        — 18.7% of heap (374 MB)
       Single ConnectionPool instance retains 18.7% of reachable heap.
```

**Analysis:**

1. **MetricBuffer (52.3%):** The telemetry system buffers metrics before shipping them to the metrics backend. The buffer has grown to 1 GB — the shipping thread is likely stuck or the backend is unreachable.

2. **ConnectionPool (18.7%):** 374 MB in a connection pool. Expand in the Dominator Tree to see if connections are holding large response buffers that were never released.

**Priority:** Fix MetricBuffer first (52% of heap). Add a bounded buffer with overflow discard. Then investigate the connection pool.
