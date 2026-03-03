---
sidebar_position: 8
title: "Compare Tab"
---

# Compare Tab

The Compare tab enables side-by-side delta analysis between two HPROF heap dumps. By selecting a baseline (older) dump and comparing it against the currently open dump, you get a precise, quantified view of what changed: which classes grew, which shrank, which leak suspects appeared or disappeared, and how overall memory usage shifted. This is the fastest way to validate a fix, confirm a regression, or track memory behavior across releases.

## How to Use

### Prerequisites

You must have **two or more `.hprof` files open and analyzed** in VS Code. HeapLens analyzes each file when you open it, so simply open both the baseline dump and the current dump before switching to the Compare tab.

### Steps

1. **Open both heap dumps** — Open the baseline (older) `.hprof` file and the current (newer) `.hprof` file in VS Code. HeapLens will analyze each one automatically.

2. **Navigate to the Compare tab** — Click the **Compare** tab in the current dump's editor. When the tab activates, HeapLens queries the backend for all other analyzed files and populates the baseline dropdown.

3. **Select a baseline** — Use the **Baseline file** dropdown to pick the older dump you want to compare against:

```
┌─────────────────────────────────────────────────────────────────────┐
│  Baseline file:  [ /tmp/app-before-fix.hprof  ▼]  [Compare]       │
└─────────────────────────────────────────────────────────────────────┘
```

4. **Click Compare** — The button is disabled until you select a baseline. Once clicked, HeapLens sends a `compare_heaps` request to the Rust backend. A "Comparing..." status message appears while the engine computes deltas across summaries, histograms, leak suspects, and waste metrics.

5. **Review results** — The comparison results render below the controls, organized into distinct sections.

:::tip
If the dropdown says "No other analyzed files available," you need to open and view at least one other `.hprof` file first. Simply opening the file in VS Code triggers analysis.
:::

## What You See

The comparison results are divided into four sections: Summary Delta, Class Changes, Leak Suspect Changes, and Waste Delta.

### Summary Delta Cards

Six stat cards show high-level metrics for the current dump alongside the delta from the baseline:

```
┌───────────────┐ ┌───────────────┐ ┌───────────────┐ ┌───────────────┐ ┌───────────────┐ ┌───────────────┐
│  Total Heap   │ │   Reachable   │ │   Instances   │ │    Classes    │ │    Arrays     │ │   GC Roots    │
│   1.50 GB     │ │   1.12 GB     │ │   2,450,000   │ │    12,340     │ │   890,000     │ │     3,200     │
│  +512.00 MB   │ │  +380.20 MB   │ │   +850,000    │ │      +120     │ │   +340,000    │ │      +800     │
└───────────────┘ └───────────────┘ └───────────────┘ └───────────────┘ └───────────────┘ └───────────────┘
```

| Card | Meaning |
|------|---------|
| **Total Heap** | Total heap size of the current dump, with the byte delta from baseline |
| **Reachable** | Reachable (live) heap size, with delta |
| **Instances** | Total object instance count, with delta |
| **Classes** | Total loaded class count, with delta |
| **Arrays** | Total array count, with delta |
| **GC Roots** | Total GC root count, with delta |

Deltas are color-coded:
- **Red** (positive delta) — the metric increased, meaning more memory or more objects
- **Green** (negative delta) — the metric decreased
- **Dimmed** (zero delta) — no change

### Class Histogram Diff Table

Below the summary cards, a filterable table lists every class that differs between the two dumps. The table is sorted by absolute retained size delta (largest changes first), capped at 200 rows by default.

```
┌──────────────────────────────────┬───────────┬──────────────┬──────────────┬──────────────┬───────────────┬───────────────┐
│ Class                            │ Change    │ Instances (Δ)│ Shallow (Δ)  │ Retained (Δ) │ Baseline Ret. │ Current Ret.  │
├──────────────────────────────────┼───────────┼──────────────┼──────────────┼──────────────┼───────────────┼───────────────┤
│ c.e.cache.SessionData            │ GREW      │   +200,000   │  +9.60 MB    │ +384.00 MB   │   128.00 MB   │   512.00 MB   │
│ c.e.model.Order                  │ GREW      │    +45,000   │  +2.16 MB    │  +90.00 MB   │    30.00 MB   │   120.00 MB   │
│ c.e.legacy.OldHandler            │ REMOVED   │    -12,000   │  -576.00 KB  │  -24.00 MB   │    24.00 MB   │         0 B   │
│ c.e.v2.NewProcessor              │ NEW       │     +8,000   │  +384.00 KB  │  +16.00 MB   │         0 B   │    16.00 MB   │
│ java.lang.String                 │ GREW      │   +100,000   │  +2.40 MB    │   +4.80 MB   │    12.00 MB   │    16.80 MB   │
│ java.util.HashMap                │ UNCHANGED │          +0  │       +0 B   │        +0 B  │     8.00 MB   │     8.00 MB   │
│ c.e.util.TempBuffer              │ SHRANK    │     -5,000   │   -240.00 KB │   -1.20 MB   │     3.20 MB   │     2.00 MB   │
└──────────────────────────────────┴───────────┴──────────────┴──────────────┴──────────────┴───────────────┴───────────────┘
```

A search box above the table lets you filter by class name in real time.

#### Column Descriptions

| Column | Meaning |
|--------|---------|
| **Class** | Fully-qualified Java class name |
| **Change** | Badge indicating the nature of the change (see below) |
| **Instances (delta)** | Difference in instance count between current and baseline |
| **Shallow (delta)** | Difference in total shallow size for this class |
| **Retained (delta)** | Difference in total retained size for this class |
| **Baseline Ret.** | Total retained size of this class in the baseline dump |
| **Current Ret.** | Total retained size of this class in the current dump |

#### Change Badges

Each class row has a colored badge indicating its change category:

| Badge | Meaning | Color |
|-------|---------|-------|
| **NEW** | Class exists only in the current dump, not in the baseline | Red |
| **REMOVED** | Class existed in the baseline but is absent from the current dump | Green |
| **GREW** | Class exists in both dumps but retained size increased | Yellow/Warning |
| **SHRANK** | Class exists in both dumps but retained size decreased | Blue |
| **UNCHANGED** | Class exists in both dumps with identical retained size | Gray (dimmed) |

### Leak Suspect Changes

If either dump has leak suspects (objects or classes retaining more than 10% of the heap), this section shows how they changed between the two dumps. Each suspect is displayed as a card with a colored left border:

```
┌─────────────────────────────────────────────────────────────────────┐
│ ┃  com.example.cache.SessionData                             NEW   │
│ ┃  Single class retaining >10% of heap                             │
│ ┃  Current: 512.00 MB (31.4%)                                      │
├─────────────────────────────────────────────────────────────────────┤
│ ┃  com.example.legacy.OldHandler                         RESOLVED  │
│ ┃  Single class retaining >10% of heap                             │
│ ┃  Was: 256.00 MB (22.0%)                                          │
├─────────────────────────────────────────────────────────────────────┤
│ ┃  com.example.messaging.MessageBroker                  PERSISTED  │
│ ┃  Single object retaining >10% of heap                            │
│ ┃  Baseline: 380.00 MB (32.6%) -> Current: 420.00 MB (25.8%)      │
│ ┃  (+40.00 MB)                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

#### Suspect Change Types

| Type | Meaning | Border Color |
|------|---------|--------------|
| **NEW** | Suspect appears only in the current dump — a potential new leak | Red |
| **RESOLVED** | Suspect existed in the baseline but is gone in the current dump — the leak was fixed | Green |
| **PERSISTED** | Suspect exists in both dumps — the leak is still present, possibly growing or shrinking | Yellow/Warning |

For **persisted** and **new** suspects, the card shows the current retained size and percentage, the baseline values (if applicable), and the delta. For **resolved** suspects, it shows the baseline size that was freed.

### Waste Delta

If waste analysis data is available for both dumps, a final section shows how memory waste changed:

```
┌───────────────┐ ┌───────────────┐ ┌───────────────┐ ┌───────────────┐
│  Total Waste  │ │   Waste %     │ │  Dup. Strings │ │  Empty Colls. │
│   45.20 MB    │ │     8.8%      │ │  +12.40 MB    │ │   -3.20 MB    │
│  +12.40 MB    │ │   +1.2pp      │ │  +12.40 MB    │ │   -3.20 MB    │
└───────────────┘ └───────────────┘ └───────────────┘ └───────────────┘
```

| Card | Meaning |
|------|---------|
| **Total Waste** | Current total wasted bytes with delta from baseline |
| **Waste %** | Waste as a percentage of heap, with delta in percentage points (pp) |
| **Dup. Strings** | Change in bytes wasted by duplicate `java.lang.String` instances |
| **Empty Colls.** | Change in bytes wasted by empty collections (`HashMap`, `ArrayList`, etc.) |

## How to Interpret Results

### Growing Classes Suggest Leaks

The most important signal in the Compare tab is classes with large positive retained size deltas. If a class's retained size grew significantly between two dumps taken under similar load, that class is likely accumulating objects that are never released.

**What to look for:**
- Classes with **GREW** badges and large retained deltas at the top of the histogram diff
- The same class appearing as a **NEW** leak suspect
- Retained growth that is disproportionate to instance count growth (each instance is getting larger, or the objects they reference are growing)

### Resolved Suspects Mean Fixes Worked

When you apply a fix and take a new heap dump, the Compare tab confirms success:
- A suspect moving from the baseline to **RESOLVED** means the fix eliminated the leak
- A suspect still **PERSISTED** but with a smaller retained size means the fix helped but did not fully resolve the issue
- A suspect still **PERSISTED** with a larger retained size means the fix was ineffective or introduced a new problem

### New Suspects Indicate Regressions

A **NEW** leak suspect that was not present in the baseline is a red flag. It may mean:
- A new code path is accumulating objects
- A dependency upgrade introduced a leak
- The fix for one leak shifted memory pressure to another area

### Unchanged Classes Are Safe to Ignore

Classes with the **UNCHANGED** badge and zero deltas are stable. They appear in the table for completeness but require no action.

### Waste Trends

Rising duplicate string waste suggests growing caches or log buffers with repetitive content. Rising empty collection waste often points to over-allocation in constructors. Falling waste after a fix confirms the optimization worked.

## Example Walkthrough

**Scenario:** Your team deployed a fix for a memory leak in the session cache. You want to confirm the fix worked by comparing heap dumps taken before and after the deployment.

### Step 1: Capture and Open Both Dumps

Take a heap dump from the production JVM before deploying the fix (`before-fix.hprof`) and another after the fix has been running for the same duration under similar load (`after-fix.hprof`). Open both files in VS Code.

### Step 2: Navigate to Compare

In the `after-fix.hprof` editor, click the **Compare** tab. Select `before-fix.hprof` as the baseline from the dropdown and click **Compare**.

### Step 3: Check the Summary Delta

```
┌───────────────┐ ┌───────────────┐ ┌───────────────┐
│  Total Heap   │ │   Reachable   │ │   Instances   │
│   820.00 MB   │ │   640.00 MB   │ │   1,200,000   │
│  -680.00 MB   │ │  -480.00 MB   │ │   -800,000    │
└───────────────┘ └───────────────┘ └───────────────┘
```

The total heap dropped by 680 MB and instance count decreased by 800,000. This is a strong positive signal.

### Step 4: Inspect the Histogram Diff

```
┌──────────────────────────────────┬───────────┬──────────────┬──────────────┐
│ Class                            │ Change    │ Instances (Δ)│ Retained (Δ) │
├──────────────────────────────────┼───────────┼──────────────┼──────────────┤
│ c.e.cache.SessionData            │ SHRANK    │   -750,000   │ -620.00 MB   │
│ java.util.HashMap$Node           │ SHRANK    │   -750,000   │  -36.00 MB   │
│ java.lang.String                 │ SHRANK    │    -50,000   │   -1.20 MB   │
│ c.e.metrics.MetricCollector      │ GREW      │     +2,000   │   +0.80 MB   │
└──────────────────────────────────┴───────────┴──────────────┴──────────────┘
```

`SessionData` shrank by 620 MB — the cache fix is clearly working. The `HashMap$Node` reduction tracks with it (the sessions were stored in a HashMap). A small growth in `MetricCollector` is worth noting but not alarming.

### Step 5: Confirm Leak Suspect Resolution

```
┌─────────────────────────────────────────────────────────────────────┐
│ ┃  com.example.cache.SessionData                         RESOLVED  │
│ ┃  Single class retaining >10% of heap                             │
│ ┃  Was: 780.00 MB (52.0%)                                          │
└─────────────────────────────────────────────────────────────────────┘
```

The session cache leak suspect is **RESOLVED**. It was retaining 52% of the heap in the baseline and is no longer flagged in the current dump.

### Step 6: Check for New Issues

No **NEW** leak suspects appeared. The `MetricCollector` growth is small (+0.80 MB) and well below the 10% threshold for leak suspect detection. The fix is clean.

### Step 7: Verify Waste Improvement

```
┌───────────────┐ ┌───────────────┐
│  Total Waste  │ │   Waste %     │
│   12.40 MB    │ │     1.5%      │
│  -18.60 MB    │ │   -0.5pp      │
└───────────────┘ └───────────────┘
```

Total waste dropped by 18.60 MB — the expired sessions had been holding duplicate strings and empty collections. With the sessions gone, that waste is gone too.

**Conclusion:** The fix successfully eliminated the `SessionData` leak, reducing heap usage by 680 MB. No new issues were introduced. The deployment is validated.
