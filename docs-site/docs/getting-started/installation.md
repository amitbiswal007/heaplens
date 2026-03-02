---
sidebar_position: 1
title: Installation
---

# Installation

HeapLens is a VS Code extension backed by a high-performance Rust analysis engine. This guide walks you through getting it running on your machine.

## Prerequisites

| Dependency | Version | Purpose |
|-----------|---------|---------|
| **VS Code** | 1.74+ | Extension host |
| **Rust toolchain** | stable | Building the analysis server |
| **Node.js** | 18+ | Building the TypeScript extension |
| **npm** | 9+ | Dependency management |

### Installing Rust

If you don't have Rust installed:

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source $HOME/.cargo/env
rustc --version   # verify
```

## Build from Source

### 1. Clone the repository

```bash
git clone https://github.com/sachinkg12/HeapLens.git
cd HeapLens
```

### 2. Build the Rust analysis server

The analysis server is a standalone binary (`hprof-server`) that the extension communicates with over stdin/stdout.

```bash
cd hprof-analyzer
cargo build --release
```

The binary is produced at `hprof-analyzer/target/release/hprof-server`. The extension knows to look for it at this path during development.

### 3. Build the TypeScript extension

```bash
# From the project root
npm install
npm run compile
```

### 4. Verify the build

```bash
# Rust tests (use --release to avoid memory pressure on macOS)
cd hprof-analyzer && cargo test --release --lib

# TypeScript compilation check
npm run compile

# Lint
npm run lint
```

## Running the Extension

1. Open the project in VS Code
2. Press **F5** to launch the Extension Development Host
3. In the new window, open any `.hprof` file — HeapLens activates automatically

The extension registers as a custom editor for `.hprof` files. Opening one triggers the full analysis pipeline.

## Platform Notes

| Platform | Status | Notes |
|----------|--------|-------|
| macOS (Apple Silicon) | Fully supported | Primary development platform |
| macOS (Intel) | Supported | |
| Linux (x86_64) | Supported | |
| Windows | Supported | Binary built as `hprof-server.exe` |

The Rust server uses memory-mapped I/O (`memmap2`), which works natively across all platforms.
