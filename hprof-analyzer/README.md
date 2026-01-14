# hprof-analyzer

A production-quality Rust library crate for loading and analyzing Java HPROF files with zero-copy memory mapping.

## Overview

This crate provides a safe, high-performance interface for memory-mapping HPROF files, enabling efficient parsing of large heap dumps without loading them entirely into RAM.

## Features

- **Zero-copy I/O**: Uses OS-level memory mapping for direct access to file data
- **Safe interface**: Wraps `unsafe` memory mapping operations in a safe API
- **Comprehensive error handling**: Typed errors using `thiserror`
- **Observability**: Built-in logging support with `log` and `env_logger`
- **Extensive documentation**: Detailed comments explaining safety guarantees

## Dependencies

- `jvm-hprof` - For parsing HPROF file format
- `memmap2` - For zero-copy memory-mapped I/O
- `anyhow` - For error handling and context
- `thiserror` - For typed error definitions
- `log` - For logging facade
- `env_logger` - For logging implementation

## Usage

```rust
use hprof_analyzer::HprofLoader;
use std::path::PathBuf;

// Create a loader for an HPROF file
let loader = HprofLoader::new(PathBuf::from("heap.hprof"));

// Memory-map the file for zero-copy access
let mmap = loader.map_file()?;

// Use the memory map as a byte slice
println!("File size: {} bytes", mmap.len());
println!("First 100 bytes: {:?}", &mmap[..100.min(mmap.len())]);
```

## Safety Guarantees

The `HprofLoader::map_file()` method uses `unsafe` internally but provides a **safe** interface by:

1. **Read-only mapping**: Creates read-only memory maps, preventing accidental file modification
2. **OS-level protection**: The OS enforces read-only access at the page level
3. **Lifetime management**: The `Mmap` handle maintains mapping validity until dropped
4. **Error handling**: All failure cases are properly handled and returned as errors

### Why `unsafe` is Used

The `memmap2::MmapOptions::map()` method is marked `unsafe` because:
- It provides raw access to OS-managed memory pages
- It bypasses Rust's normal ownership and borrowing rules
- Platform-specific behavior varies (Windows vs Unix)

However, our usage is safe because:
- We only create read-only mappings
- We maintain the file handle to prevent truncation
- We validate files before mapping
- We handle all error cases explicitly

## Performance Benefits

- **Zero-copy**: Data accessed directly from OS page cache
- **Lazy loading**: Pages loaded on-demand via OS page faults
- **OS optimization**: Automatic page cache management
- **Efficient for large files**: Handles multi-GB files without loading into RAM

## Testing

The crate includes comprehensive tests:

```bash
cargo test
```

Tests cover:
- Mapping dummy files with test data
- Error handling for empty files
- Error handling for non-existent files
- Read-only access verification
- Large file handling (1MB+)

## Example Test

```rust
use hprof_analyzer::HprofLoader;
use std::io::Write;
use tempfile::NamedTempFile;

let mut temp_file = NamedTempFile::new()?;
temp_file.write_all(b"JAVA PROFILE 1.0.2\0test data")?;

let loader = HprofLoader::new(temp_file.path().to_path_buf());
let mmap = loader.map_file()?;

assert_eq!(&mmap[..17], b"JAVA PROFILE 1.0.2");
```

## Architecture

```
hprof-analyzer/
├── Cargo.toml          # Dependencies and crate metadata
├── src/
│   └── lib.rs          # Main library implementation
└── README.md           # This file
```

## Error Types

The crate defines `HprofLoaderError` with three variants:
- `FileOpen`: Failed to open the file (permissions, doesn't exist, etc.)
- `MapCreation`: Failed to create memory map (OS-level error)
- `EmptyFile`: File is empty (0 bytes)

## Logging

Enable logging with `env_logger`:

```rust
env_logger::Builder::from_default_env()
    .filter_level(log::LevelFilter::Debug)
    .init();

let loader = HprofLoader::new(path);
let mmap = loader.map_file()?; // Will log debug/info messages
```

## Future Enhancements

- Add file locking support for concurrent access safety
- Add validation for HPROF file format
- Add streaming/chunked parsing support
- Add metrics for memory mapping performance
