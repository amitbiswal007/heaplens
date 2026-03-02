---
sidebar_position: 4
title: GC Roots
---

# GC Roots

GC roots are the starting points of the Java garbage collector's reachability analysis. An object is "alive" (will not be collected) if and only if there is a chain of references from at least one GC root to that object.

Understanding GC roots is critical for leak analysis: a memory leak occurs when objects remain reachable from GC roots even after the application no longer needs them.

## Types of GC Roots

HeapLens detects and displays all standard GC root types from the HPROF format:

| Root Type | Description | Common Source |
|-----------|-------------|---------------|
| **System Class** | Classes loaded by the bootstrap classloader | `java.lang.String`, `java.util.HashMap`, core JDK |
| **Thread Object** | Active `Thread` instances | Every running thread is a root |
| **Java Stack Frame** | Local variables on the call stack of active threads | Method parameters, local variables |
| **JNI Global** | Native code holding global references | JNI libraries, native frameworks |
| **JNI Local** | Native code holding local references | Active JNI method calls |
| **Monitor (Busy)** | Objects used as synchronization locks | `synchronized(obj)` blocks |
| **Unknown** | Vendor-specific or unclassified roots | JVM internals |

## How GC Roots Cause Leaks

A memory leak in Java is almost always a **logical leak** — objects that the developer considers "done" but that remain reachable from a GC root.

### Example: Thread-Local Leak

```java
private static final ThreadLocal<List<Request>> requestLog = new ThreadLocal<>();

void handleRequest(Request req) {
    List<Request> log = requestLog.get();
    if (log == null) {
        log = new ArrayList<>();
        requestLog.set(log);
    }
    log.add(req);   // Never cleared!
}
```

The reference chain is:

```
GC Root (Thread) → ThreadLocalMap → Entry → ArrayList → Request objects
```

Each thread accumulates `Request` objects forever because `requestLog` is never cleared. In a thread pool, the threads live for the application's lifetime, so this memory is never reclaimed.

### Example: Static Collection Leak

```java
public class EventBus {
    private static final Map<String, List<Listener>> listeners = new HashMap<>();

    public static void subscribe(String event, Listener l) {
        listeners.computeIfAbsent(event, k -> new ArrayList<>()).add(l);
    }
    // No unsubscribe method — listeners accumulate forever
}
```

```
GC Root (System Class) → EventBus.class → static field "listeners" → HashMap → Listener objects
```

The `static` field is a GC root through the system class. Every subscribed listener stays alive until the application shuts down.

## GC Root Path in HeapLens

HeapLens can show the **shortest path from GC roots to any object**. This is the most direct answer to "why is this object alive?"

To use it:
1. In the **Dominator Tree** tab, find the object you're investigating
2. Click the pin icon or right-click and select "GC Root Path"
3. A breadcrumb trail appears showing the reference chain from the root

The path is computed via BFS backward traversal through the object graph's reverse references, starting from the target object and walking toward the SuperRoot.

### Reading a GC Root Path

```
Thread "http-worker-42"
  → ThreadLocalMap$Entry
    → ConnectionPool
      → ArrayList
        → Connection #1847
```

This tells you:
- The `Connection` is alive because of `http-worker-42`'s thread-local storage
- The `ConnectionPool` holds it in an `ArrayList`
- **Action:** The connection should have been returned to the pool and the thread-local cleared after the request completed

## SuperRoot

HeapLens adds a synthetic **SuperRoot** node that connects to all GC roots. This creates a single entry point for the dominator tree computation. The SuperRoot itself is not a real JVM object — it exists only as a graph modeling convenience. It is filtered out of all user-facing displays.

```
SuperRoot (synthetic)
  ├─→ GC Root: Thread "main"
  ├─→ GC Root: Thread "http-worker-1"
  ├─→ GC Root: System Class java.lang.String
  └─→ GC Root: JNI Global ref #42
```
