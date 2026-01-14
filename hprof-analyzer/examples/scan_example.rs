//! Example: Scan HPROF records and print statistics
//!
//! This example demonstrates how to use `HprofLoader` and `scan_records`
//! to analyze an HPROF file and print statistics to stdout.

use hprof_analyzer::{scan_records, HprofLoader};
use std::env;
use std::path::PathBuf;

fn main() -> anyhow::Result<()> {
    // Initialize logging
    env_logger::Builder::from_default_env()
        .filter_level(log::LevelFilter::Info)
        .init();

    // Get HPROF file path from command line arguments
    let args: Vec<String> = env::args().collect();
    if args.len() != 2 {
        eprintln!("Usage: {} <path-to-hprof-file>", args[0]);
        std::process::exit(1);
    }

    let hprof_path = PathBuf::from(&args[1]);

    println!("Loading HPROF file: {:?}", hprof_path);

    // Step 1: Create a loader and memory-map the file
    let loader = HprofLoader::new(hprof_path);
    let mmap = loader.map_file()?;

    println!("File mapped successfully ({} bytes)", mmap.len());
    println!();

    // Step 2: Scan records using zero-copy iteration
    println!("Scanning HPROF records...");
    let stats = scan_records(&mmap[..])?;

    // Step 3: Print statistics to stdout
    println!();
    stats.print();

    Ok(())
}
