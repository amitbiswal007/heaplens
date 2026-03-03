---
sidebar_position: 3
title: "Chat Participant (@heaplens)"
---

# Chat Participant (@heaplens)

HeapLens registers as a **VS Code Chat Participant**, making it available in the chat panels of extensions that support the VS Code Language Model API. This includes GitHub Copilot, Cline, and Claude Dev.

## Setup

No additional configuration is needed. The `@heaplens` participant is automatically registered when the HeapLens extension activates. You just need:

1. **HeapLens extension** installed in VS Code
2. **A chat extension** that supports the VS Code LM API:
   - [GitHub Copilot](https://marketplace.visualstudio.com/items?itemName=GitHub.copilot-chat) (most common)
   - [Cline](https://marketplace.visualstudio.com/items?itemName=saoudrizwan.claude-dev)
   - Any extension that registers language models via `vscode.lm`
3. **An open `.hprof` file** analyzed by HeapLens

## Usage

In the chat panel, type `@heaplens` followed by your question:

```
@heaplens What is the biggest memory consumer in this heap dump?
```

### Slash Commands

Three slash commands provide focused analysis:

| Command | Description | Example |
|---------|-------------|---------|
| `/analyze` | General heap analysis (default) | `@heaplens /analyze` |
| `/leaks` | Focused leak suspect analysis | `@heaplens /leaks Are there any unbounded caches?` |
| `/explain` | Explain a specific class or concept | `@heaplens /explain java.util.HashMap` |

If you don't use a slash command, `/analyze` is the default behavior.

### Examples

```
@heaplens What are the top 3 things I should fix to reduce memory?

@heaplens /leaks

@heaplens /leaks Is the SessionCache growing over time?

@heaplens /explain Why is byte[] the largest class by shallow size?
```

## How It Works

```
User types "@heaplens What's using all the memory?"
        │
        ▼
VS Code routes to HeapLens chat participant
        │
        ▼
Participant reads current heap analysis data
        │
        ▼
Builds prompt with analysis context
  (same promptTemplates.ts as direct API)
        │
        ▼
Calls vscode.lm.selectChatModels()
  → tries GPT-4o first, falls back to any model
        │
        ▼
Streams response via model.sendRequest()
        │
        ▼
Response appears in the chat panel
```

The chat participant uses the **VS Code Language Model API** (`vscode.lm`), which means:
- No API key configuration needed (the host extension handles authentication)
- Model selection is automatic (prefers GPT-4o, falls back to whatever is available)
- Conversation history is managed by the chat panel

## vs. Built-in AI Chat Tab

| Feature | Chat Participant (@heaplens) | AI Chat Tab (API Key) |
|---------|------------------------------|----------------------|
| **Where** | Copilot/Cline chat panel | Inside HeapLens editor |
| **API key** | Not needed | Required |
| **Model** | Whatever the host provides | Your choice (Anthropic/OpenAI) |
| **Explain Object** | Not available | Available |
| **Explain Leak** | Not available | Available |
| **Conversation context** | Full chat history from panel | Per-editor (20 exchanges) |

The chat participant is best for quick questions. The built-in AI Chat tab with an API key gives you more control and access to the Explain features.

## Troubleshooting

**"No heap analysis data available"**
Open an `.hprof` file and wait for the analysis to complete before using `@heaplens`.

**"No language model available"**
Make sure GitHub Copilot (or another LM-providing extension) is installed and you are signed in.

**@heaplens doesn't appear in the chat panel**
Restart VS Code. The participant is registered during extension activation, which happens when you first open an `.hprof` file or run a HeapLens command.
