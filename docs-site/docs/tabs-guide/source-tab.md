---
sidebar_position: 6
title: Source Tab
---

# Source Tab

The Source tab bridges heap analysis with your application's source code. It maps classes from the heap dump to source files in your workspace, allowing you to navigate directly from a memory-heavy class to the code that defines it.

## What You See

A table similar to the Histogram tab, but filtered to show only classes that can potentially be resolved to source files, with an additional tier badge:

```
Class Name                         Tier          Instances   Shallow    Retained
com.example.cache.DataCache        App           1           48 B       512 MB
com.example.model.UserSession      App           45,000      6.8 MB     312 MB
org.springframework.context...     Third-party   12          1.2 KB     85 MB
java.util.HashMap                  Core          12,400      580 KB     245 MB
```

### Tier Classification

| Tier | Badge Color | Description |
|------|------------|-------------|
| **App** | Green | Your project's source code — classes found in the current workspace |
| **Third-party** | Blue | Classes from Maven/Gradle dependencies |
| **Core** | Gray | JDK standard library classes |

## Interactions

### Go to Source

Click on any class name with an **App** tier badge. HeapLens opens the corresponding source file in an adjacent editor column.

For example, clicking `com.example.cache.DataCache` opens `src/main/java/com/example/cache/DataCache.java`.

### Sorting and Filtering

The same sorting (click column headers) and search filtering as the Histogram tab are available. Useful filters:

- Type your package prefix to see only your code
- Sort by Retained Size to focus on the biggest memory consumers in your codebase

## How Source Resolution Works

HeapLens resolves class names to source files using a three-step process:

1. **Workspace search** — Converts the fully-qualified class name to a file path pattern (`com.example.Foo` → `**/com/example/Foo.java`) and searches your VS Code workspace
2. **Dependency resolution** — If not found locally, checks Maven (`pom.xml`) or Gradle (`build.gradle`) dependencies to identify the library
3. **JDK classification** — Known `java.*`, `javax.*`, `sun.*` packages are classified as Core

Results are cached per editor session to avoid redundant filesystem lookups.

## Example Walkthrough

**Scenario:** The Leak Suspects tab flagged `com.example.service.NotificationQueue` as retaining 35% of the heap.

**Step 1:** Open the Source tab, search for `NotificationQueue`.

```
com.example.service.NotificationQueue    App    1    64 B    525 MB
```

**Step 2:** Click the class name. VS Code opens `NotificationQueue.java`:

```java
public class NotificationQueue {
    private final Queue<Notification> pending = new LinkedList<>();

    public void enqueue(Notification n) {
        pending.add(n);
    }

    // No dequeue or size limit!
}
```

**Step 3:** The issue is clear — notifications are enqueued but never consumed or bounded. Add a size limit and a consumer thread.

## When Source Resolution Fails

If a class cannot be resolved:
- **Inner classes** (`Foo$Bar`) — The resolver looks for the outer class file
- **Generated classes** (proxies, lambdas) — These don't have source files; use the Dominator Tree to understand their context
- **Dependency not in workspace** — Third-party classes require the library source to be attached or the dependency to be declared in your build file
