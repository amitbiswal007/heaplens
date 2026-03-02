---
sidebar_position: 1
title: Introduction
---

# MCP Integration

HeapLens includes a built-in **Model Context Protocol (MCP)** server, allowing AI clients like Claude Desktop to analyze Java heap dumps directly through tool calls.

## What is MCP?

The [Model Context Protocol](https://modelcontextprotocol.io/) is an open standard that enables AI assistants to interact with external tools and data sources. An MCP server exposes "tools" that an AI can call, similar to function calling but with a standardized protocol.

HeapLens's Rust backend runs as an MCP server when started with the `--mcp` flag. It exposes six tools for heap analysis, returning LLM-friendly markdown text.

## Why MCP?

MCP decouples heap analysis from VS Code. With MCP, you can:

- **Analyze heaps from Claude Desktop** — No IDE needed. Drag a heap dump into a conversation and Claude can analyze it.
- **Build custom AI workflows** — Any MCP-compatible client can use HeapLens as a tool.
- **Automate analysis** — Script heap analysis into CI/CD pipelines or incident response runbooks.

## Architecture

```
┌─────────────────────────────────┐
│  AI Client (Claude Desktop)     │
│                                  │
│  "Analyze this heap dump"       │
│         │                        │
│         ▼                        │
│  tools/call: analyze_heap       │
│         │                        │
├─────────┼────────────────────────┤
│         │  stdin/stdout          │
│         ▼  (JSON-RPC 2.0)       │
│  ┌────────────────────────┐     │
│  │  hprof-server --mcp    │     │
│  │                        │     │
│  │  MCP Protocol Handler  │     │
│  │    ├─ initialize       │     │
│  │    ├─ tools/list       │     │
│  │    └─ tools/call       │     │
│  │                        │     │
│  │  Analysis Engine       │     │
│  │    └─ (same lib.rs)   │     │
│  └────────────────────────┘     │
└─────────────────────────────────┘
```

The MCP server uses the exact same analysis engine as the VS Code extension. The only difference is the protocol layer:

| Mode | Protocol | Response Format | Client |
|------|----------|----------------|--------|
| JSON-RPC (default) | Custom JSON-RPC 2.0 | Structured JSON objects | VS Code extension |
| MCP (`--mcp`) | MCP standard | Markdown text blocks | AI clients |

## Available Tools

| Tool | Description |
|------|-------------|
| `analyze_heap` | Full analysis of an HPROF file. Must be called first. |
| `get_leak_suspects` | Detected memory leak suspects |
| `get_class_histogram` | Class-level memory aggregation |
| `drill_down` | Explore dominator tree children of a specific object |
| `get_summary` | Heap statistics (sizes, counts) |
| `get_waste_analysis` | Duplicate strings and empty collections |

See [Tools Reference](./tools-reference) for detailed parameter and response documentation.

## Example Conversation

With HeapLens configured as an MCP server in Claude Desktop:

> **You:** I have a heap dump at `/tmp/production-heap.hprof`. The service is using 2 GB when it should use 500 MB. Can you analyze it?
>
> **Claude:** Let me analyze that heap dump for you.
> *[Calls analyze_heap with path "/tmp/production-heap.hprof"]*
>
> The heap analysis reveals:
> - **Total Heap Size:** 2.08 GB (1.64 GB reachable)
> - **Primary suspect:** `com.example.cache.ResultCache` retains 72.3% of the heap (1.18 GB)
> - **Secondary finding:** 45 MB of duplicate strings (2.7% waste)
>
> The `ResultCache` is backed by a `ConcurrentHashMap` with 850,000 entries. This appears to be an unbounded cache. Let me drill into it...
> *[Calls drill_down with object_id from the analysis]*
>
> The cache entries are `QueryResult` objects averaging 1.4 KB each. Recommendations:
> 1. Add a maximum size limit (e.g., 10,000 entries with LRU eviction)
> 2. Add TTL-based expiration (results older than 5 minutes are likely stale)
> 3. Consider using Caffeine instead of a raw ConcurrentHashMap for built-in eviction
