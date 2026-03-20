---
sidebar_position: 9
---

# Timeline

The Timeline tab provides multi-snapshot trend analysis, letting you track how your application's memory usage changes over time.

## What It Shows

Load multiple heap dump snapshots and visualize memory trends with interactive D3.js line charts. This is useful for identifying gradual memory leaks that only become apparent over time.

## How to Use

1. Open a heap dump file in HeapLens
2. Navigate to the **Timeline** tab
3. Load additional snapshots to compare trends
4. Hover over data points to see exact values at each snapshot

## Key Metrics Tracked

- **Total heap size** across snapshots
- **Top growing classes** that increase in retained size over time
- **Object count trends** by class

## When to Use Timeline

- **Gradual leaks**: Memory slowly grows over hours or days
- **Before/after deployments**: Compare memory behavior across releases
- **Load testing**: Track memory during sustained traffic
- **GC tuning**: Observe heap behavior across GC cycles

:::tip
For comparing exactly two snapshots in detail, use the [Compare tab](./compare-tab) instead. Timeline is best for 3+ snapshots to identify trends.
:::
