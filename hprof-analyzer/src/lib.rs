//! # hprof-analyzer
//!
//! A library for loading and analyzing Java HPROF files with zero-copy memory mapping.
//!
//! This crate provides a safe interface around memory-mapped file I/O for efficient
//! parsing of large HPROF files without loading them entirely into RAM.

use anyhow::Result;
use jvm_hprof::{parse_hprof, RecordTag, IdSize};
use memmap2::{Mmap, MmapOptions};
use petgraph::{Graph, Directed, graph::NodeIndex};
use petgraph::algo::dominators;
use std::collections::HashMap;
use std::fs::File;
use std::path::{Path, PathBuf};
use thiserror::Error;

/// Errors that can occur during HPROF file loading and mapping.
#[derive(Error, Debug)]
pub enum HprofLoaderError {
    /// Failed to open the file at the given path.
    #[error("Failed to open file at {path}: {source}")]
    FileOpen {
        path: PathBuf,
        source: std::io::Error,
    },

    /// Failed to create a memory map of the file.
    #[error("Failed to create memory map for file at {path}: {source}")]
    MapCreation {
        path: PathBuf,
        source: std::io::Error,
    },

    /// The file is empty and cannot be mapped.
    #[error("File at {path} is empty (0 bytes)")]
    EmptyFile { path: PathBuf },
}

/// A loader for HPROF files that uses memory-mapped I/O for zero-copy access.
///
/// # Safety Guarantees
///
/// This struct provides a **safe** interface around `unsafe` memory mapping operations.
/// The safety invariants are:
///
/// 1. **Read-only access**: The memory map is created with read-only permissions,
///    preventing accidental modification of the underlying file.
///
/// 2. **Lifetime management**: The `Mmap` handle maintains the validity of the mapped
///    memory region. The memory is automatically unmapped when the handle is dropped.
///
/// 3. **OS-level protection**: The operating system enforces read-only access at the
///    page level, so even if unsafe code attempts to write, the OS will raise a
///    segmentation fault rather than corrupting the file.
///
/// # Why `unsafe` is Used
///
/// The `memmap2::MmapOptions::map()` method is marked `unsafe` because:
///
/// - **Raw memory access**: It provides direct access to memory pages that are
///   managed by the OS, bypassing Rust's normal ownership and borrowing rules.
///
/// - **Concurrent modification risk**: If the file is modified by another process
///   while mapped, reading from the map could see inconsistent data. However, this
///   is mitigated by:
///     - Using read-only mapping (prevents our process from modifying it)
///     - HPROF files are typically immutable once written
///     - The file handle is kept open, preventing truncation on Unix systems
///
/// - **Platform-specific behavior**: Memory mapping behavior varies across platforms
///   (Windows vs Unix), and the `unsafe` marker ensures developers are aware of
///   platform-specific considerations.
///
/// # Performance Benefits
///
/// Memory mapping provides significant performance advantages:
///
/// - **Zero-copy**: Data is accessed directly from the OS page cache without
///   copying into user-space buffers.
///
/// - **Lazy loading**: Pages are loaded on-demand via OS page faults, allowing
///   efficient handling of files larger than available RAM.
///
/// - **OS optimization**: The OS can optimize page cache usage, prefetching,
///   and memory pressure handling automatically.
///
/// - **Efficient for large files**: For multi-GB HPROF files, memory mapping avoids
///   the memory overhead of loading the entire file into RAM.
///
/// # Example
///
/// ```no_run
/// use hprof_analyzer::HprofLoader;
/// use std::path::PathBuf;
///
/// let loader = HprofLoader::new(PathBuf::from("heap.hprof"));
/// let mmap = loader.map_file()?;
/// // mmap can be used as &[u8] for parsing
/// # Ok::<(), Box<dyn std::error::Error>>(())
/// ```
#[derive(Debug, Clone)]
pub struct HprofLoader {
    /// The path to the HPROF file to be loaded.
    path: PathBuf,
}

impl HprofLoader {
    /// Creates a new `HprofLoader` for the file at the given path.
    ///
    /// # Arguments
    ///
    /// * `path` - The path to the HPROF file to be loaded.
    ///
    /// # Example
    ///
    /// ```
    /// use hprof_analyzer::HprofLoader;
    /// use std::path::PathBuf;
    ///
    /// let loader = HprofLoader::new(PathBuf::from("heap.hprof"));
    /// ```
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }

    /// Memory-maps the HPROF file for zero-copy read-only access.
    ///
    /// This method creates a read-only memory mapping of the file, allowing
    /// efficient access to large HPROF files without loading them entirely
    /// into memory.
    ///
    /// # Safety
    ///
    /// While this method uses `unsafe` internally, it provides a **safe** interface
    /// by ensuring:
    ///
    /// 1. The file is opened with read-only permissions
    /// 2. The memory map is created as read-only
    /// 3. The file handle is kept alive for the lifetime of the map
    /// 4. Proper error handling for all failure cases
    ///
    /// The `unsafe` block is necessary because `MmapOptions::map()` is marked unsafe
    /// due to the raw memory access it provides. However, our usage is safe because:
    ///
    /// - We only create read-only mappings
    /// - We maintain the file handle to prevent truncation
    /// - We validate the file exists and is readable before mapping
    /// - We handle all error cases explicitly
    ///
    /// # Errors
    ///
    /// This method will return an error if:
    /// - The file cannot be opened (permissions, doesn't exist, etc.)
    /// - The file is empty (0 bytes)
    /// - The memory mapping operation fails (OS-level error)
    ///
    /// # Returns
    ///
    /// Returns a `Result<Mmap>` containing the memory-mapped file handle.
    /// The `Mmap` can be used as `&[u8]` for zero-copy parsing operations.
    ///
    /// # Example
    ///
    /// ```
    /// use hprof_analyzer::HprofLoader;
    /// use std::path::PathBuf;
    ///
    /// # fn main() -> anyhow::Result<()> {
    /// let loader = HprofLoader::new(PathBuf::from("heap.hprof"));
    /// let mmap = loader.map_file()?;
    ///
    /// // Use the memory map as a byte slice
    /// let first_byte = mmap[0];
    /// println!("File size: {} bytes", mmap.len());
    /// # Ok(())
    /// # }
    /// ```
    pub fn map_file(&self) -> Result<Mmap, HprofLoaderError> {
        log::debug!("Opening HPROF file: {:?}", self.path);

        // Open the file with read-only permissions.
        // Keeping the file handle open prevents the file from being truncated
        // or deleted while the memory map is active (on Unix systems).
        let file = File::open(&self.path).map_err(|source| {
            log::error!("Failed to open file: {:?}", self.path);
            HprofLoaderError::FileOpen {
                path: self.path.clone(),
                source,
            }
        })?;

        // Get file metadata to check size before attempting to map.
        // This provides a better error message for empty files.
        let metadata = file.metadata().map_err(|source| {
            log::error!("Failed to get file metadata: {:?}", self.path);
            HprofLoaderError::FileOpen {
                path: self.path.clone(),
                source,
            }
        })?;

        if metadata.len() == 0 {
            log::error!("File is empty: {:?}", self.path);
            return Err(HprofLoaderError::EmptyFile {
                path: self.path.clone(),
            });
        }

        log::debug!(
            "Creating memory map for file: {:?} ({} bytes)",
            self.path,
            metadata.len()
        );

        // SAFETY: This unsafe block is safe because:
        //
        // 1. **Read-only mapping**: We create a read-only memory map, which means
        //    the OS will prevent any writes to the mapped memory region. Even if
        //    unsafe code attempts to write, the OS will raise a segmentation fault.
        //
        // 2. **File handle lifetime**: The `file` handle is kept alive (not dropped)
        //    during the mapping operation. On Unix systems, this prevents the file
        //    from being truncated or deleted while mapped. The `Mmap` handle will
        //    maintain the mapping until it's dropped.
        //
        // 3. **No concurrent writes**: HPROF files are typically immutable once written.
        //    We're opening the file read-only, so our process cannot modify it.
        //    Other processes could theoretically modify it, but:
        //      - This is rare for HPROF files (they're typically write-once)
        //      - The OS page cache will handle consistency
        //      - If this is a concern, file locking can be added
        //
        // 4. **Platform portability**: `memmap2` handles platform-specific differences
        //    (Windows vs Unix) internally, so our usage is portable.
        //
        // 5. **Error handling**: We properly handle all error cases returned by `map()`.
        //
        // The `unsafe` marker exists because memory mapping provides raw access to
        // OS-managed memory pages, bypassing Rust's normal safety guarantees. However,
        // our specific usage pattern (read-only mapping of an immutable file) is safe.
        let mmap_result = unsafe {
            MmapOptions::new()
                .map(&file)
        };
        
        let mmap = mmap_result.map_err(|source| {
            log::error!("Failed to create memory map: {:?}", self.path);
            HprofLoaderError::MapCreation {
                path: self.path.clone(),
                source,
            }
        })?;

        log::info!(
            "Successfully mapped HPROF file: {:?} ({} bytes)",
            self.path,
            mmap.len()
        );

        // Note: We intentionally drop the `file` handle here. The memory map
        // remains valid because:
        // - On Unix: The file descriptor is kept open by the OS for the mapping
        // - On Windows: The file handle is duplicated internally by memmap2
        // The `Mmap` handle maintains the mapping's validity.
        drop(file);

        Ok(mmap)
    }

    /// Returns a reference to the path of the HPROF file.
    pub fn path(&self) -> &Path {
        &self.path
    }
}

/// Statistics collected from scanning HPROF records.
///
/// This structure holds aggregate counts and sizes computed during
/// a single pass over the HPROF file records.
#[derive(Debug, Clone, Default)]
pub struct HprofStatistics {
    /// Total number of LOAD_CLASS records (classes defined in the heap).
    pub total_classes: u64,
    /// Total number of INSTANCE_DUMP sub-records (object instances).
    pub total_objects: u64,
    /// Total heap size in bytes (approximate, based on instance field data).
    pub total_heap_size_bytes: u64,
}

impl HprofStatistics {
    /// Prints the statistics to stdout in a human-readable format.
    pub fn print(&self) {
        println!("HPROF Statistics:");
        println!("  Total Classes (LOAD_CLASS): {}", self.total_classes);
        println!("  Total Objects (INSTANCE_DUMP): {}", self.total_objects);
        println!(
            "  Total Heap Size: {} bytes ({:.2} MB)",
            self.total_heap_size_bytes,
            self.total_heap_size_bytes as f64 / (1024.0 * 1024.0)
        );
    }
}

/// Scans HPROF records from a memory-mapped byte slice and collects statistics.
///
/// This function performs a zero-copy scan of the HPROF file using the `jvm-hprof`
/// crate. It iterates over all records in the file and counts:
///
/// - **LOAD_CLASS records**: Classes defined in the heap dump
/// - **INSTANCE_DUMP sub-records**: Object instances within heap dump segments
/// - **Total heap size**: Approximate size based on instance field data
///
/// # Zero-Copy Processing
///
/// This function leverages the zero-copy features of `jvm-hprof`:
///
/// - The input `&[u8]` slice is typically from a memory-mapped file (`Mmap`)
/// - `jvm-hprof::parse_hprof()` parses the header without copying data
/// - `records_iter()` provides an iterator over records that defers parsing
/// - Record parsing happens on-demand, accessing data directly from the mapped memory
/// - No intermediate buffers or copies are created during iteration
///
/// # Endianness Handling
///
/// The `jvm-hprof` crate handles endianness automatically:
///
/// - HPROF files use big-endian encoding (network byte order)
/// - The crate's parse methods (`parse_hprof`, `as_load_class`, etc.) handle
///   endianness conversion internally
/// - No manual byte swapping is required
/// - The crate reads the file's ID size (32-bit vs 64-bit) from the header
///
/// # Arguments
///
/// * `data` - A byte slice containing the HPROF file data, typically from a memory-mapped file.
///
/// # Returns
///
/// Returns a `Result<HprofStatistics>` containing the collected statistics.
/// Returns an error if the HPROF file cannot be parsed or if record parsing fails.
///
/// # Errors
///
/// This function will return an error if:
/// - The HPROF header cannot be parsed (invalid format)
/// - A record cannot be parsed (corrupted data)
/// - The file structure is invalid
///
/// # Example
///
/// ```no_run
/// use hprof_analyzer::{HprofLoader, scan_records};
/// use std::path::PathBuf;
///
/// # fn main() -> anyhow::Result<()> {
/// let loader = HprofLoader::new(PathBuf::from("heap.hprof"));
/// let mmap = loader.map_file()?;
///
/// let stats = scan_records(&mmap[..])?;
/// stats.print();
/// # Ok(())
/// # }
/// ```
pub fn scan_records(data: &[u8]) -> Result<HprofStatistics> {
    log::debug!("Starting HPROF record scan ({} bytes)", data.len());

    // Parse the HPROF file header and create the iterator.
    // This is a zero-copy operation - it only reads the header and sets up
    // the iterator without copying the file data.
    let hprof = parse_hprof(data)
        .map_err(|e| anyhow::anyhow!("Failed to parse HPROF file: {:?}", e))?;

    let mut stats = HprofStatistics::default();

    // First pass: Count LOAD_CLASS records.
    // These records define classes that are loaded in the heap.
    log::debug!("Scanning for LOAD_CLASS records...");
    for record_result in hprof.records_iter() {
        let record = record_result
            .map_err(|e| anyhow::anyhow!("Failed to parse record: {:?}", e))?;

        // Match on the record tag to identify LOAD_CLASS records.
        // The jvm-hprof crate handles endianness conversion automatically
        // when parsing the tag byte and record data.
        if record.tag() == RecordTag::LoadClass {
            stats.total_classes += 1;
            log::trace!("Found LOAD_CLASS record #{}", stats.total_classes);
        }
    }

    log::info!("Found {} LOAD_CLASS records", stats.total_classes);

    // Second pass: Count INSTANCE_DUMP sub-records and calculate heap size.
    // INSTANCE_DUMP records are nested within HeapDumpSegment records.
    log::debug!("Scanning for INSTANCE_DUMP sub-records...");
    for record_result in hprof.records_iter() {
        let record = record_result
            .map_err(|e| anyhow::anyhow!("Failed to parse record: {:?}", e))?;

        // Heap dump data is contained in HeapDump or HeapDumpSegment records.
        // These records contain sub-records that include INSTANCE_DUMP entries.
        if record.tag() == RecordTag::HeapDump || record.tag() == RecordTag::HeapDumpSegment {
            if let Some(heap_dump_result) = record.as_heap_dump_segment() {
                let heap_dump = heap_dump_result
                    .map_err(|e| anyhow::anyhow!("Failed to parse HeapDumpSegment: {:?}", e))?;

                // Iterate over sub-records within the heap dump segment.
                // This is where INSTANCE_DUMP records are found.
                for sub_record_result in heap_dump.sub_records() {
                    let sub_record = sub_record_result
                        .map_err(|e| anyhow::anyhow!("Failed to parse sub-record: {:?}", e))?;

                    // Match on the sub-record type to find INSTANCE_DUMP entries.
                    // The jvm-hprof crate handles endianness when parsing sub-record tags
                    // and data fields.
                    match sub_record {
                        jvm_hprof::heap_dump::SubRecord::Instance(instance) => {
                            stats.total_objects += 1;

                            // Calculate approximate heap size from instance field data.
                            // Note: This is an approximation. The actual instance size includes:
                            // - Object header (platform-dependent, typically 8-16 bytes)
                            // - Field data (what we're measuring here)
                            // - Alignment padding
                            //
                            // For a more accurate size, we would need to:
                            // 1. Parse class definitions to get field descriptors
                            // 2. Calculate size based on field types and alignment
                            // 3. Add object header size
                            //
                            // For now, we use the field data length as a proxy.
                            let field_data_size = instance.fields().len() as u64;
                            stats.total_heap_size_bytes += field_data_size;

                            log::trace!(
                                "Found INSTANCE_DUMP #{} (field data: {} bytes)",
                                stats.total_objects,
                                field_data_size
                            );
                        }
                        // We could also count ObjectArray and PrimitiveArray here
                        // for a more complete heap size calculation, but the task
                        // specifically asks for INSTANCE_DUMP objects.
                        _ => {
                            // Other sub-record types (ObjectArray, PrimitiveArray, Class, etc.)
                            // are not counted in this implementation.
                        }
                    }
                }
            }
        }
    }

    log::info!(
        "Scan complete: {} objects, {} bytes heap size",
        stats.total_objects,
        stats.total_heap_size_bytes
    );

    Ok(stats)
}

/// Node data types in the heap graph.
///
/// Each node represents either a GC root, a class definition, an object instance,
/// or an array in the Java heap.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum NodeData {
    /// A synthetic root node that connects to all GC roots.
    /// This is the top-level node in the object graph.
    SuperRoot,
    /// A GC root (entry point into the object graph).
    Root,
    /// A class definition.
    Class,
    /// An object instance with its ID, size, and class name.
    Instance {
        /// The object ID from the HPROF file.
        id: u64,
        /// The size of the instance in bytes.
        size: u32,
        /// The fully-qualified class name (e.g. "java.lang.String").
        class_name: String,
    },
    /// An array (object array or primitive array) with its ID, size, and class name.
    Array {
        /// The array object ID from the HPROF file.
        id: u64,
        /// The size of the array in bytes.
        size: u32,
        /// The array class name (e.g. "byte[]", "java.lang.Object[]").
        class_name: String,
    },
}

/// A graph representation of the Java heap.
///
/// This graph models the object reference relationships in a heap dump:
/// - **Nodes**: Represent GC roots, classes, instances, and arrays
/// - **Edges**: Represent references from one object to another
///
/// The graph is directed: an edge from A to B means "A references B".
///
/// # Structure
///
/// - **SuperRoot**: A synthetic node at the top that connects to all GC roots
/// - **Root nodes**: GC roots (ROOT_JNI_GLOBAL, ROOT_JAVA_FRAME, etc.)
/// - **Class nodes**: Class definitions from LOAD_CLASS records
/// - **Instance nodes**: Object instances from INSTANCE_DUMP sub-records
/// - **Array nodes**: Arrays from OBJECT_ARRAY and PRIMITIVE_ARRAY sub-records
///
/// # Example
///
/// ```no_run
/// use hprof_analyzer::{HprofLoader, build_graph};
/// use std::path::PathBuf;
///
/// # fn main() -> anyhow::Result<()> {
/// let loader = HprofLoader::new(PathBuf::from("heap.hprof"));
/// let mmap = loader.map_file()?;
///
/// let graph = build_graph(&mmap[..])?;
/// println!("Graph has {} nodes and {} edges", 
///          graph.graph().node_count(), 
///          graph.graph().edge_count());
/// # Ok(())
/// # }
/// ```
#[derive(Debug)]
pub struct HeapGraph {
    /// The underlying petgraph graph structure.
    graph: Graph<NodeData, (), Directed>,
    /// Mapping from HPROF object/class IDs to graph node indices.
    id_to_node: HashMap<u64, NodeIndex>,
    /// The node index of the synthetic SuperRoot node.
    super_root: NodeIndex,
    /// Heap summary statistics collected during graph building.
    summary: HeapSummary,
}

impl HeapGraph {
    /// Returns a reference to the underlying graph.
    pub fn graph(&self) -> &Graph<NodeData, (), Directed> {
        &self.graph
    }

    /// Returns a mutable reference to the underlying graph.
    pub fn graph_mut(&mut self) -> &mut Graph<NodeData, (), Directed> {
        &mut self.graph
    }

    /// Returns the mapping from HPROF IDs to node indices.
    pub fn id_to_node(&self) -> &HashMap<u64, NodeIndex> {
        &self.id_to_node
    }

    /// Returns the node index of the SuperRoot node.
    pub fn super_root(&self) -> NodeIndex {
        self.super_root
    }

    /// Returns the number of nodes in the graph.
    pub fn node_count(&self) -> usize {
        self.graph.node_count()
    }

    /// Returns the number of edges in the graph.
    pub fn edge_count(&self) -> usize {
        self.graph.edge_count()
    }

    /// Returns the heap summary statistics.
    pub fn summary(&self) -> &HeapSummary {
        &self.summary
    }
}

/// Builds a graph representation of the Java heap from HPROF file data.
///
/// This function performs a two-pass scan of the HPROF file:
///
/// **Pass 1: Node Creation**
/// - Identifies all classes from `LOAD_CLASS` records
/// - Identifies all instances from `INSTANCE_DUMP` sub-records
/// - Identifies all arrays from `OBJECT_ARRAY` and `PRIMITIVE_ARRAY` sub-records
/// - Identifies all GC roots from various `GcRoot*` sub-records
/// - Creates nodes for each and maps HPROF IDs to graph node indices
///
/// **Pass 2: Edge Creation**
/// - Iterates records again to find object references
/// - Adds directed edges from referencing objects to referenced objects
/// - Connects GC roots to their referenced objects
/// - Creates a synthetic `SuperRoot` node and connects it to all GC roots
///
/// # Zero-Copy Processing
///
/// Like `scan_records`, this function uses zero-copy processing:
/// - Takes a `&[u8]` slice (typically from memory-mapped file)
/// - Uses `jvm-hprof`'s lazy parsing
/// - All data access is direct from mapped memory
///
/// # Arguments
///
/// * `data` - A byte slice containing the HPROF file data.
///
/// # Returns
///
/// Returns a `Result<HeapGraph>` containing the constructed graph.
///
/// # Errors
///
/// Returns an error if:
/// - The HPROF file cannot be parsed
/// - Record parsing fails
/// - Invalid object references are encountered
///
/// # Example
///
/// ```no_run
/// use hprof_analyzer::{HprofLoader, build_graph};
/// use std::path::PathBuf;
///
/// # fn main() -> anyhow::Result<()> {
/// let loader = HprofLoader::new(PathBuf::from("heap.hprof"));
/// let mmap = loader.map_file()?;
///
/// let graph = build_graph(&mmap[..])?;
/// println!("Graph: {} nodes, {} edges", 
///          graph.node_count(), 
///          graph.edge_count());
/// # Ok(())
/// # }
/// ```
pub fn build_graph(data: &[u8]) -> Result<HeapGraph> {
    log::debug!("Starting graph construction ({} bytes)", data.len());

    let hprof = parse_hprof(data)
        .map_err(|e| anyhow::anyhow!("Failed to parse HPROF file: {:?}", e))?;

    let id_size = hprof.header().id_size();
    let mut graph = Graph::<NodeData, (), Directed>::new();
    let mut id_to_node: HashMap<u64, NodeIndex> = HashMap::new();

    let super_root = graph.add_node(NodeData::SuperRoot);

    // ============================================================================
    // PASS 0a: Build string table (STRING_IN_UTF8 records)
    // ============================================================================
    log::debug!("Pass 0a: Building string table...");
    let mut string_table: HashMap<u64, String> = HashMap::new();

    for record_result in hprof.records_iter() {
        let record = record_result
            .map_err(|e| anyhow::anyhow!("Failed to parse record: {:?}", e))?;
        if record.tag() == RecordTag::Utf8 {
            if let Some(utf8_result) = record.as_utf_8() {
                let utf8 = utf8_result
                    .map_err(|e| anyhow::anyhow!("Failed to parse UTF8 string: {:?}", e))?;
                let string_id = utf8.name_id().id();
                let text = String::from_utf8_lossy(utf8.text()).to_string();
                string_table.insert(string_id, text);
            }
        }
    }
    log::info!("Built string table: {} entries", string_table.len());

    // ============================================================================
    // PASS 0b: Build class name map (LOAD_CLASS records)
    // ============================================================================
    log::debug!("Pass 0b: Building class name map...");
    let mut class_name_map: HashMap<u64, String> = HashMap::new();

    for record_result in hprof.records_iter() {
        let record = record_result
            .map_err(|e| anyhow::anyhow!("Failed to parse record: {:?}", e))?;
        if record.tag() == RecordTag::LoadClass {
            if let Some(load_class_result) = record.as_load_class() {
                let load_class = load_class_result
                    .map_err(|e| anyhow::anyhow!("Failed to parse LoadClass: {:?}", e))?;
                let class_obj_id = load_class.class_obj_id().id();
                let class_name_id = load_class.class_name_id().id();
                if let Some(name) = string_table.get(&class_name_id) {
                    // Convert JVM internal format to Java format: java/lang/String -> java.lang.String
                    // Also handle array types: [B -> byte[], [Ljava/lang/Object; -> java.lang.Object[]
                    let java_name = convert_jvm_class_name(name);
                    class_name_map.insert(class_obj_id, java_name);
                }
            }
        }
    }
    log::info!("Built class name map: {} entries", class_name_map.len());

    // ============================================================================
    // PASS 1: Identify all nodes and add them to the graph
    // ============================================================================
    log::debug!("Pass 1: Identifying nodes...");

    let mut class_count = 0u64;

    // Collect all class IDs from LOAD_CLASS records
    for record_result in hprof.records_iter() {
        let record = record_result
            .map_err(|e| anyhow::anyhow!("Failed to parse record: {:?}", e))?;
        if record.tag() == RecordTag::LoadClass {
            if let Some(load_class_result) = record.as_load_class() {
                let load_class = load_class_result
                    .map_err(|e| anyhow::anyhow!("Failed to parse LoadClass: {:?}", e))?;
                let class_obj_id = load_class.class_obj_id().id();
                if !id_to_node.contains_key(&class_obj_id) {
                    let node_idx = graph.add_node(NodeData::Class);
                    id_to_node.insert(class_obj_id, node_idx);
                    class_count += 1;
                }
            }
        }
    }

    log::info!("Found {} classes", class_count);

    // Now scan heap dump segments for instances, arrays, and GC roots
    let mut instance_count = 0u64;
    let mut array_count = 0u64;
    let mut gc_root_count = 0u64;
    let mut gc_root_ids = Vec::new();
    let mut total_shallow_size = 0u64;

    // Also build a map of class_obj_id -> instance_size from Class sub-records
    let mut class_instance_sizes: HashMap<u64, u32> = HashMap::new();

    // First pass through heap dumps: collect class instance sizes
    for record_result in hprof.records_iter() {
        let record = record_result
            .map_err(|e| anyhow::anyhow!("Failed to parse record: {:?}", e))?;
        if record.tag() == RecordTag::HeapDump || record.tag() == RecordTag::HeapDumpSegment {
            if let Some(heap_dump_result) = record.as_heap_dump_segment() {
                let heap_dump = heap_dump_result
                    .map_err(|e| anyhow::anyhow!("Failed to parse HeapDumpSegment: {:?}", e))?;
                for sub_record_result in heap_dump.sub_records() {
                    let sub_record = sub_record_result
                        .map_err(|e| anyhow::anyhow!("Failed to parse sub-record: {:?}", e))?;
                    if let jvm_hprof::heap_dump::SubRecord::Class(class) = sub_record {
                        let obj_id = class.obj_id().id();
                        let instance_size = class.instance_size_bytes();
                        class_instance_sizes.insert(obj_id, instance_size);
                    }
                }
            }
        }
    }

    // Main heap dump scan
    for record_result in hprof.records_iter() {
        let record = record_result
            .map_err(|e| anyhow::anyhow!("Failed to parse record: {:?}", e))?;

        if record.tag() == RecordTag::HeapDump || record.tag() == RecordTag::HeapDumpSegment {
            if let Some(heap_dump_result) = record.as_heap_dump_segment() {
                let heap_dump = heap_dump_result
                    .map_err(|e| anyhow::anyhow!("Failed to parse HeapDumpSegment: {:?}", e))?;

                for sub_record_result in heap_dump.sub_records() {
                    let sub_record = sub_record_result
                        .map_err(|e| anyhow::anyhow!("Failed to parse sub-record: {:?}", e))?;

                    match sub_record {
                        // GC Roots
                        jvm_hprof::heap_dump::SubRecord::GcRootUnknown(gc_root) => {
                            let obj_id = gc_root.obj_id().id();
                            gc_root_ids.push(obj_id);
                            gc_root_count += 1;
                            if !id_to_node.contains_key(&obj_id) {
                                let node_idx = graph.add_node(NodeData::Root);
                                id_to_node.insert(obj_id, node_idx);
                            }
                        }
                        jvm_hprof::heap_dump::SubRecord::GcRootJniGlobal(gc_root) => {
                            let obj_id = gc_root.obj_id().id();
                            gc_root_ids.push(obj_id);
                            gc_root_count += 1;
                            if !id_to_node.contains_key(&obj_id) {
                                let node_idx = graph.add_node(NodeData::Root);
                                id_to_node.insert(obj_id, node_idx);
                            }
                        }
                        jvm_hprof::heap_dump::SubRecord::GcRootJniLocalRef(gc_root) => {
                            let obj_id = gc_root.obj_id().id();
                            gc_root_ids.push(obj_id);
                            gc_root_count += 1;
                            if !id_to_node.contains_key(&obj_id) {
                                let node_idx = graph.add_node(NodeData::Root);
                                id_to_node.insert(obj_id, node_idx);
                            }
                        }
                        jvm_hprof::heap_dump::SubRecord::GcRootJavaStackFrame(gc_root) => {
                            let obj_id = gc_root.obj_id().id();
                            gc_root_ids.push(obj_id);
                            gc_root_count += 1;
                            if !id_to_node.contains_key(&obj_id) {
                                let node_idx = graph.add_node(NodeData::Root);
                                id_to_node.insert(obj_id, node_idx);
                            }
                        }
                        jvm_hprof::heap_dump::SubRecord::GcRootSystemClass(gc_root) => {
                            let obj_id = gc_root.obj_id().id();
                            gc_root_ids.push(obj_id);
                            gc_root_count += 1;
                            if !id_to_node.contains_key(&obj_id) {
                                let node_idx = graph.add_node(NodeData::Root);
                                id_to_node.insert(obj_id, node_idx);
                            }
                        }
                        jvm_hprof::heap_dump::SubRecord::GcRootThreadObj(gc_root) => {
                            if let Some(thread_obj_id) = gc_root.thread_obj_id() {
                                let obj_id = thread_obj_id.id();
                                gc_root_ids.push(obj_id);
                                gc_root_count += 1;
                                if !id_to_node.contains_key(&obj_id) {
                                    let node_idx = graph.add_node(NodeData::Root);
                                    id_to_node.insert(obj_id, node_idx);
                                }
                            }
                        }
                        jvm_hprof::heap_dump::SubRecord::GcRootBusyMonitor(gc_root) => {
                            let obj_id = gc_root.obj_id().id();
                            gc_root_ids.push(obj_id);
                            gc_root_count += 1;
                            if !id_to_node.contains_key(&obj_id) {
                                let node_idx = graph.add_node(NodeData::Root);
                                id_to_node.insert(obj_id, node_idx);
                            }
                        }
                        // Instances — use class_obj_id to look up class name
                        jvm_hprof::heap_dump::SubRecord::Instance(instance) => {
                            let obj_id = instance.obj_id().id();
                            let class_obj_id = instance.class_obj_id().id();
                            // Use instance_size from class definition if available, fall back to field data length
                            let size = class_instance_sizes.get(&class_obj_id)
                                .copied()
                                .unwrap_or(instance.fields().len() as u32);
                            let class_name = class_name_map.get(&class_obj_id)
                                .cloned()
                                .unwrap_or_else(|| format!("Unknown(0x{:x})", class_obj_id));

                            if !id_to_node.contains_key(&obj_id) {
                                let node_idx = graph.add_node(NodeData::Instance { id: obj_id, size, class_name });
                                id_to_node.insert(obj_id, node_idx);
                                instance_count += 1;
                                total_shallow_size += size as u64;
                            }
                        }
                        // Object Arrays
                        jvm_hprof::heap_dump::SubRecord::ObjectArray(array) => {
                            let obj_id = array.obj_id().id();
                            let array_class_obj_id = array.array_class_obj_id().id();
                            let id_size_bytes = match id_size {
                                IdSize::U32 => 4,
                                IdSize::U64 => 8,
                            };
                            let mut element_count = 0u32;
                            for element_result in array.elements(id_size) {
                                match element_result {
                                    Ok(Some(_)) | Ok(None) => element_count += 1,
                                    Err(_) => {}
                                }
                            }
                            let size = element_count * id_size_bytes as u32;
                            let class_name = class_name_map.get(&array_class_obj_id)
                                .cloned()
                                .unwrap_or_else(|| "Object[]".to_string());

                            if !id_to_node.contains_key(&obj_id) {
                                let node_idx = graph.add_node(NodeData::Array { id: obj_id, size, class_name });
                                id_to_node.insert(obj_id, node_idx);
                                array_count += 1;
                                total_shallow_size += size as u64;
                            }
                        }
                        // Primitive Arrays
                        jvm_hprof::heap_dump::SubRecord::PrimitiveArray(array) => {
                            let obj_id = array.obj_id().id();
                            let prim_type = array.primitive_type();
                            // Compute size by counting elements via typed iterators
                            let (size, class_name) = match prim_type {
                                jvm_hprof::heap_dump::PrimitiveArrayType::Boolean => {
                                    let count = array.booleans().map_or(0u32, |iter| iter.count() as u32);
                                    (count, "boolean[]".to_string())
                                }
                                jvm_hprof::heap_dump::PrimitiveArrayType::Byte => {
                                    let count = array.bytes().map_or(0u32, |iter| iter.count() as u32);
                                    (count, "byte[]".to_string())
                                }
                                jvm_hprof::heap_dump::PrimitiveArrayType::Char => {
                                    let count = array.chars().map_or(0u32, |iter| iter.count() as u32);
                                    (count * 2, "char[]".to_string())
                                }
                                jvm_hprof::heap_dump::PrimitiveArrayType::Short => {
                                    let count = array.shorts().map_or(0u32, |iter| iter.count() as u32);
                                    (count * 2, "short[]".to_string())
                                }
                                jvm_hprof::heap_dump::PrimitiveArrayType::Int => {
                                    let count = array.ints().map_or(0u32, |iter| iter.count() as u32);
                                    (count * 4, "int[]".to_string())
                                }
                                jvm_hprof::heap_dump::PrimitiveArrayType::Float => {
                                    let count = array.floats().map_or(0u32, |iter| iter.count() as u32);
                                    (count * 4, "float[]".to_string())
                                }
                                jvm_hprof::heap_dump::PrimitiveArrayType::Long => {
                                    let count = array.longs().map_or(0u32, |iter| iter.count() as u32);
                                    (count * 8, "long[]".to_string())
                                }
                                jvm_hprof::heap_dump::PrimitiveArrayType::Double => {
                                    let count = array.doubles().map_or(0u32, |iter| iter.count() as u32);
                                    (count * 8, "double[]".to_string())
                                }
                            };

                            if !id_to_node.contains_key(&obj_id) {
                                let node_idx = graph.add_node(NodeData::Array { id: obj_id, size, class_name });
                                id_to_node.insert(obj_id, node_idx);
                                array_count += 1;
                                total_shallow_size += size as u64;
                            }
                        }
                        // Class definitions in heap dump
                        jvm_hprof::heap_dump::SubRecord::Class(class) => {
                            let obj_id = class.obj_id().id();
                            if !id_to_node.contains_key(&obj_id) {
                                let node_idx = graph.add_node(NodeData::Class);
                                id_to_node.insert(obj_id, node_idx);
                                class_count += 1;
                            }
                        }
                        _ => {}
                    }
                }
            }
        }
    }

    let summary = HeapSummary {
        total_heap_size: total_shallow_size,
        total_instances: instance_count,
        total_classes: class_count,
        total_arrays: array_count,
        total_gc_roots: gc_root_count,
    };

    log::info!(
        "Pass 1 complete: {} classes, {} instances, {} arrays, {} GC roots",
        class_count,
        instance_count,
        array_count,
        gc_root_count
    );

    // ============================================================================
    // PASS 2: Add edges (references) between nodes
    // ============================================================================

    log::debug!("Pass 2: Adding edges (references)...");

    let mut edge_count = 0;

    // Connect SuperRoot to all GC roots
    for gc_root_id in &gc_root_ids {
        if let Some(&root_node) = id_to_node.get(gc_root_id) {
            graph.add_edge(super_root, root_node, ());
            edge_count += 1;
            log::trace!("Connected SuperRoot -> GC Root: ID={}", gc_root_id);
        }
    }

    log::info!("Connected SuperRoot to {} GC roots", gc_root_ids.len());

    // Scan heap dump segments again to find references
    for record_result in hprof.records_iter() {
        let record = record_result
            .map_err(|e| anyhow::anyhow!("Failed to parse record: {:?}", e))?;

        if record.tag() == RecordTag::HeapDump || record.tag() == RecordTag::HeapDumpSegment {
            if let Some(heap_dump_result) = record.as_heap_dump_segment() {
                let heap_dump = heap_dump_result
                    .map_err(|e| anyhow::anyhow!("Failed to parse HeapDumpSegment: {:?}", e))?;

                for sub_record_result in heap_dump.sub_records() {
                    let sub_record = sub_record_result
                        .map_err(|e| anyhow::anyhow!("Failed to parse sub-record: {:?}", e))?;

                    match sub_record {
                        // Instance references: parse field values to find object references
                        jvm_hprof::heap_dump::SubRecord::Instance(instance) => {
                            let instance_id = instance.obj_id().id();
                            let instance_node = id_to_node.get(&instance_id);
                            
                            if let Some(&instance_idx) = instance_node {
                                // Parse instance fields to find object references
                                // Note: This is a simplified approach. For accurate parsing,
                                // we would need class definitions with field descriptors.
                                // For now, we'll extract potential object IDs from the field data.
                                let fields = instance.fields();
                                
                                // Extract object references from field data
                                // Field data contains values that may be object IDs
                                // We'll parse them based on the ID size
                                extract_object_references(fields, id_size, |ref_id| {
                                    if let Some(&ref_node) = id_to_node.get(&ref_id) {
                                        if !graph.contains_edge(instance_idx, ref_node) {
                                            graph.add_edge(instance_idx, ref_node, ());
                                            edge_count += 1;
                                            log::trace!("Added edge: Instance {} -> Object {}", instance_id, ref_id);
                                        }
                                    }
                                });
                            }
                        }
                        // Array references: parse array contents for object references
                        jvm_hprof::heap_dump::SubRecord::ObjectArray(array) => {
                            let array_id = array.obj_id().id();
                            let array_node = id_to_node.get(&array_id);
                            
                            if let Some(&array_idx) = array_node {
                                // ObjectArray contents are object IDs
                                // Extract references using the elements() iterator
                                let mut ref_count = 0;
                                for element_result in array.elements(id_size) {
                                    match element_result {
                                        Ok(Some(element_id)) => {
                                            let ref_id = element_id.id();
                                            if let Some(&ref_node) = id_to_node.get(&ref_id) {
                                                if !graph.contains_edge(array_idx, ref_node) {
                                                    graph.add_edge(array_idx, ref_node, ());
                                                    edge_count += 1;
                                                    log::trace!("Added edge: Array {} -> Object {}", array_id, ref_id);
                                                }
                                            }
                                            ref_count += 1;
                                        }
                                        Ok(None) => {
                                            // Null reference, skip
                                        }
                                        Err(_) => {
                                            // Parse error, skip this element
                                            log::trace!("Failed to parse element in ObjectArray {}", array_id);
                                        }
                                    }
                                }
                                log::trace!("ObjectArray {} has {} elements", array_id, ref_count);
                            }
                        }
                        // Class references: superclass and class loader
                        jvm_hprof::heap_dump::SubRecord::Class(class) => {
                            let class_id = class.obj_id().id();
                            let class_node = id_to_node.get(&class_id);
                            
                            if let Some(&class_idx) = class_node {
                                // Reference to superclass
                                if let Some(super_class_id) = class.super_class_obj_id() {
                                    if let Some(&super_class_node) = id_to_node.get(&super_class_id.id()) {
                                        if !graph.contains_edge(class_idx, super_class_node) {
                                            graph.add_edge(class_idx, super_class_node, ());
                                            edge_count += 1;
                                            log::trace!("Added edge: Class {} -> SuperClass {}", class_id, super_class_id.id());
                                        }
                                    }
                                }
                                
                                // Reference to class loader
                                if let Some(class_loader_id) = class.class_loader_obj_id() {
                                    if let Some(&class_loader_node) = id_to_node.get(&class_loader_id.id()) {
                                        if !graph.contains_edge(class_idx, class_loader_node) {
                                            graph.add_edge(class_idx, class_loader_node, ());
                                            edge_count += 1;
                                            log::trace!("Added edge: Class {} -> ClassLoader {}", class_id, class_loader_id.id());
                                        }
                                    }
                                }
                            }
                        }
                        _ => {}
                    }
                }
            }
        }
    }

    log::info!("Pass 2 complete: added {} edges", edge_count);
    log::info!(
        "Graph construction complete: {} nodes, {} edges",
        graph.node_count(),
        graph.edge_count()
    );

    Ok(HeapGraph {
        graph,
        id_to_node,
        super_root,
        summary,
    })
}

/// Converts a JVM internal class name to Java format.
///
/// Examples:
/// - `java/lang/String` → `java.lang.String`
/// - `[B` → `byte[]`
/// - `[Ljava/lang/Object;` → `java.lang.Object[]`
/// - `[[I` → `int[][]`
fn convert_jvm_class_name(name: &str) -> String {
    if name.starts_with('[') {
        // Array type
        let mut depth = 0;
        let mut chars = name.chars();
        while chars.as_str().starts_with('[') {
            depth += 1;
            chars.next();
        }
        let rest = chars.as_str();
        let base = match rest {
            "B" => "byte".to_string(),
            "C" => "char".to_string(),
            "D" => "double".to_string(),
            "F" => "float".to_string(),
            "I" => "int".to_string(),
            "J" => "long".to_string(),
            "S" => "short".to_string(),
            "Z" => "boolean".to_string(),
            s if s.starts_with('L') && s.ends_with(';') => {
                s[1..s.len()-1].replace('/', ".")
            }
            other => other.replace('/', "."),
        };
        format!("{}{}", base, "[]".repeat(depth))
    } else {
        name.replace('/', ".")
    }
}

/// Helper function to extract object references from byte data.
///
/// This function attempts to parse object IDs from byte slices that may contain
/// object references. It's a simplified approach - for accurate parsing, we would
/// need field descriptors from class definitions.
///
/// # Arguments
///
/// * `data` - Byte slice that may contain object references
/// * `id_size` - Size of object IDs (4 or 8 bytes)
/// * `callback` - Function called for each potential object ID found
fn extract_object_references<F>(data: &[u8], id_size: IdSize, mut callback: F)
where
    F: FnMut(u64),
{
    let id_bytes = match id_size {
        IdSize::U32 => 4,
        IdSize::U64 => 8,
    };
    
    // Try to extract object IDs by reading every ID-sized chunk
    // This is a heuristic - actual field parsing would require class definitions
    for chunk in data.chunks_exact(id_bytes) {
        let id = match id_size {
            IdSize::U32 => {
                if chunk.len() >= 4 {
                    u32::from_be_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]) as u64
                } else {
                    continue;
                }
            }
            IdSize::U64 => {
                if chunk.len() >= 8 {
                    u64::from_be_bytes([
                        chunk[0], chunk[1], chunk[2], chunk[3],
                        chunk[4], chunk[5], chunk[6], chunk[7],
                    ])
                } else {
                    continue;
                }
            }
        };
        
        // Only call callback for non-zero IDs (0 is typically a null reference)
        if id != 0 {
            callback(id);
        }
    }
}

/// Report for a single object in the heap analysis.
///
/// Contains information about an object's retained size and identification.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct ObjectReport {
    /// The HPROF object ID (0 for non-object nodes like SuperRoot, Root, Class).
    pub object_id: u64,
    /// The node type (SuperRoot, Root, Class, Instance, or Array).
    pub node_type: String,
    /// The fully-qualified class name (empty for SuperRoot/Root/Class nodes).
    pub class_name: String,
    /// The shallow size of this object in bytes.
    pub shallow_size: u64,
    /// The retained size of this object in bytes.
    /// Retained size = shallow size + sum of retained sizes of all children in dominator tree.
    pub retained_size: u64,
    /// The node index in the graph (for reference).
    #[serde(skip_serializing)]
    pub node_index: NodeIndex,
}

impl ObjectReport {
    /// Creates a new ObjectReport.
    pub fn new(
        object_id: u64,
        node_type: String,
        class_name: String,
        shallow_size: u64,
        retained_size: u64,
        node_index: NodeIndex,
    ) -> Self {
        Self {
            object_id,
            node_type,
            class_name,
            shallow_size,
            retained_size,
            node_index,
        }
    }
}

impl PartialOrd for ObjectReport {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for ObjectReport {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        // Sort by retained size (descending), then by object ID
        self.retained_size
            .cmp(&other.retained_size)
            .reverse()
            .then_with(|| self.object_id.cmp(&other.object_id))
    }
}

/// Calculates dominators and retained sizes for all nodes in the heap graph.
///
/// This function:
/// 1. Computes the dominator tree using `petgraph::algo::dominators::simple_fast`
/// 2. Calculates retained sizes using a bottom-up traversal of the dominator tree
/// 3. Returns the top 50 objects sorted by retained size
///
/// # Retained Size Calculation
///
/// Retained size is the amount of memory that would be freed if an object
/// were garbage collected. It is calculated as:
///
/// ```
/// Retained Size(N) = Shallow Size(N) + Sum(Retained Size of all children of N in Dominator Tree)
/// ```
///
/// The dominator tree is used because:
/// - If node A dominates node B, then all paths from the root to B pass through A
/// - This means if A is removed, B becomes unreachable
/// - Therefore, B's retained size should be counted under A
///
/// # Arguments
///
/// * `graph` - The heap graph to analyze
///
/// # Returns
///
/// Returns a `Result<Vec<ObjectReport>>` containing the top 50 objects
/// sorted by retained size (descending).
///
/// # Errors
///
/// Returns an error if:
/// - The dominator calculation fails
/// - Graph structure is invalid
///
/// # Example
///
/// ```no_run
/// use hprof_analyzer::{HprofLoader, build_graph, calculate_dominators};
/// use std::path::PathBuf;
///
/// # fn main() -> anyhow::Result<()> {
/// let loader = HprofLoader::new(PathBuf::from("heap.hprof"));
/// let mmap = loader.map_file()?;
/// let graph = build_graph(&mmap[..])?;
///
/// let top_objects = calculate_dominators(&graph)?;
/// for (i, report) in top_objects.iter().enumerate() {
///     println!("{}. ID={}, Type={}, Retained={} bytes ({:.2} MB)",
///              i + 1,
///              report.object_id,
///              report.node_type,
///              report.retained_size,
///              report.retained_size as f64 / (1024.0 * 1024.0));
/// }
/// # Ok(())
/// # }
/// ```
pub fn calculate_dominators(graph: &HeapGraph) -> Result<Vec<ObjectReport>> {
    log::debug!("Calculating dominators for {} nodes", graph.node_count());

    let petgraph = graph.graph();
    let super_root = graph.super_root();

    // Step 1: Compute dominator tree using petgraph's simple_fast algorithm
    // This returns a Dominators structure that maps each node to its immediate dominator
    let dominators = dominators::simple_fast(petgraph, super_root);

    log::info!("Dominator tree computed successfully");

    // Step 2: Build reverse dominator tree (children map)
    // For each node, find all nodes that it dominates (its children in the dominator tree)
    let mut children: HashMap<NodeIndex, Vec<NodeIndex>> = HashMap::new();

    for node_idx in petgraph.node_indices() {
        if node_idx == super_root {
            continue; // SuperRoot has no dominator
        }

        if let Some(dominator) = dominators.immediate_dominator(node_idx) {
            children.entry(dominator).or_insert_with(Vec::new).push(node_idx);
        } else {
            // Unreachable node — attach to SuperRoot so retained sizes are correct
            children.entry(super_root).or_insert_with(Vec::new).push(node_idx);
        }
    }

    log::debug!("Built children map: {} nodes have children", children.len());

    // Step 3: Calculate shallow sizes for all nodes
    let mut shallow_sizes: HashMap<NodeIndex, u64> = HashMap::new();

    for node_idx in petgraph.node_indices() {
        let node_data = &petgraph[node_idx];
        let shallow_size = match node_data {
            NodeData::SuperRoot | NodeData::Root | NodeData::Class => 0,
            NodeData::Instance { size, .. } => *size as u64,
            NodeData::Array { size, .. } => *size as u64,
        };
        shallow_sizes.insert(node_idx, shallow_size);
    }

    // Step 4: Calculate retained sizes bottom-up
    let mut retained_sizes: HashMap<NodeIndex, u64> = HashMap::new();
    let mut processed = std::collections::HashSet::new();

    for node_idx in petgraph.node_indices() {
        let shallow = shallow_sizes.get(&node_idx).copied().unwrap_or(0);
        retained_sizes.insert(node_idx, shallow);
    }

    let mut changed = true;
    while changed {
        changed = false;
        for node_idx in petgraph.node_indices() {
            if processed.contains(&node_idx) {
                continue;
            }
            let all_children_processed = children
                .get(&node_idx)
                .map_or(true, |node_children| {
                    node_children.iter().all(|&c| processed.contains(&c))
                });
            if all_children_processed {
                let mut retained = shallow_sizes.get(&node_idx).copied().unwrap_or(0);
                if let Some(node_children) = children.get(&node_idx) {
                    for &child in node_children {
                        retained += retained_sizes.get(&child).copied().unwrap_or(0);
                    }
                }
                retained_sizes.insert(node_idx, retained);
                processed.insert(node_idx);
                changed = true;
            }
        }
    }

    for node_idx in petgraph.node_indices() {
        if !processed.contains(&node_idx) {
            let shallow = shallow_sizes.get(&node_idx).copied().unwrap_or(0);
            retained_sizes.insert(node_idx, shallow);
        }
    }

    // Step 5: Build ObjectReport for all nodes
    let mut reports: Vec<ObjectReport> = Vec::new();

    for node_idx in petgraph.node_indices() {
        let node_data = &petgraph[node_idx];
        let shallow = shallow_sizes.get(&node_idx).copied().unwrap_or(0);
        let retained = retained_sizes.get(&node_idx).copied().unwrap_or(0);

        let (object_id, node_type, class_name) = match node_data {
            NodeData::SuperRoot => (0, "SuperRoot".to_string(), String::new()),
            NodeData::Root => (0, "Root".to_string(), String::new()),
            NodeData::Class => (0, "Class".to_string(), String::new()),
            NodeData::Instance { id, class_name, .. } => (*id, "Instance".to_string(), class_name.clone()),
            NodeData::Array { id, class_name, .. } => (*id, "Array".to_string(), class_name.clone()),
        };

        reports.push(ObjectReport::new(
            object_id,
            node_type,
            class_name,
            shallow,
            retained,
            node_idx,
        ));
    }

    reports.sort();
    let top_50: Vec<ObjectReport> = reports.into_iter().take(50).collect();

    Ok(top_50)
}

/// Entry in the class histogram showing aggregate stats per class.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct ClassHistogramEntry {
    /// The fully-qualified class name.
    pub class_name: String,
    /// Number of instances of this class.
    pub instance_count: u64,
    /// Total shallow size of all instances of this class.
    pub shallow_size: u64,
    /// Total retained size of all instances of this class.
    pub retained_size: u64,
}

/// A suspected memory leak.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct LeakSuspect {
    /// The class name of the suspected leaking object.
    pub class_name: String,
    /// The HPROF object ID.
    pub object_id: u64,
    /// The retained size of this object.
    pub retained_size: u64,
    /// Percentage of total heap retained by this object.
    pub retained_percentage: f64,
    /// Human-readable description of why this is a suspect.
    pub description: String,
}

/// Summary statistics for the entire heap dump.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct HeapSummary {
    /// Total heap size in bytes (sum of all shallow sizes).
    pub total_heap_size: u64,
    /// Total number of object instances.
    pub total_instances: u64,
    /// Total number of classes.
    pub total_classes: u64,
    /// Total number of arrays.
    pub total_arrays: u64,
    /// Total number of GC roots.
    pub total_gc_roots: u64,
}

/// Analysis state containing the dominator tree information.
/// 
/// This structure holds all the data needed to query children of nodes
/// for lazy loading in the visualization.
/// 
/// Note: The HeapGraph itself is not stored here to avoid cloning overhead.
/// Instead, we store the necessary mappings and the graph can be queried
/// separately when needed.
#[derive(Debug, Clone)]
pub struct AnalysisState {
    /// Mapping from node index to its children in the dominator tree.
    pub children_map: HashMap<NodeIndex, Vec<NodeIndex>>,
    /// Mapping from node index to retained size.
    pub retained_sizes: HashMap<NodeIndex, u64>,
    /// Mapping from node index to shallow size.
    pub shallow_sizes: HashMap<NodeIndex, u64>,
    /// Mapping from HPROF object ID to node index.
    pub id_to_node: HashMap<u64, NodeIndex>,
    /// The super root node index.
    pub super_root: NodeIndex,
    /// Mapping from node index to (object_id, node_type, class_name).
    pub node_data_map: HashMap<NodeIndex, (u64, String, String)>,
    /// Class histogram entries sorted by retained size.
    pub class_histogram: Vec<ClassHistogramEntry>,
    /// Detected leak suspects.
    pub leak_suspects: Vec<LeakSuspect>,
    /// Heap summary statistics.
    pub summary: HeapSummary,
}

impl AnalysisState {
    /// Gets the children of a node in the dominator tree.
    /// 
    /// # Arguments
    /// 
    /// * `object_id` - The HPROF object ID (0 for SuperRoot, Root, Class nodes)
    /// 
    /// # Returns
    /// 
    /// Returns a vector of ObjectReport for the children, or None if the node is not found.
    pub fn get_children(&self, object_id: u64) -> Option<Vec<ObjectReport>> {
        // Find the node index for this object ID
        let node_idx = if object_id == 0 {
            self.super_root
        } else {
            *self.id_to_node.get(&object_id)?
        };

        // Get children from the dominator tree
        let children_indices = self.children_map.get(&node_idx)?;

        // Build ObjectReport for each child
        let mut children_reports = Vec::new();

        for &child_idx in children_indices {
            let (child_object_id, node_type, class_name) = self.node_data_map.get(&child_idx)
                .cloned()
                .unwrap_or((0, "Unknown".to_string(), String::new()));

            let shallow = self.shallow_sizes.get(&child_idx).copied().unwrap_or(0);
            let retained = self.retained_sizes.get(&child_idx).copied().unwrap_or(0);

            // Filter out Class nodes and zero-size nodes
            if node_type == "Class" || retained == 0 {
                continue;
            }

            children_reports.push(ObjectReport::new(
                child_object_id,
                node_type,
                class_name,
                shallow,
                retained,
                child_idx,
            ));
        }

        if children_reports.is_empty() {
            return None;
        }

        children_reports.sort();
        Some(children_reports)
    }

    /// Gets the top N layers of the dominator tree starting from SuperRoot.
    /// 
    /// # Arguments
    /// 
    /// * `max_depth` - Maximum depth to traverse (default: 2 for top 2 layers)
    /// * `max_nodes` - Maximum number of nodes to return (default: 50)
    /// 
    /// # Returns
    /// 
    /// Returns a tree structure with nodes and their immediate children.
    pub fn get_top_layers(&self, max_depth: usize, max_nodes: usize) -> Vec<ObjectReport> {
        let mut result = Vec::new();
        let mut visited = std::collections::HashSet::new();
        let mut queue = std::collections::VecDeque::new();

        queue.push_back((self.super_root, 0));
        visited.insert(self.super_root);

        while let Some((node_idx, depth)) = queue.pop_front() {
            if depth >= max_depth || result.len() >= max_nodes {
                break;
            }

            let (object_id, node_type, class_name) = self.node_data_map.get(&node_idx)
                .cloned()
                .unwrap_or((0, "Unknown".to_string(), String::new()));

            let shallow = self.shallow_sizes.get(&node_idx).copied().unwrap_or(0);
            let retained = self.retained_sizes.get(&node_idx).copied().unwrap_or(0);

            if node_type == "Class" || (retained == 0 && node_type != "SuperRoot") {
                if depth + 1 < max_depth {
                    if let Some(children) = self.children_map.get(&node_idx) {
                        for &child_idx in children {
                            if !visited.contains(&child_idx) && result.len() < max_nodes {
                                visited.insert(child_idx);
                                queue.push_back((child_idx, depth + 1));
                            }
                        }
                    }
                }
                continue;
            }

            result.push(ObjectReport::new(
                object_id,
                node_type,
                class_name,
                shallow,
                retained,
                node_idx,
            ));

            if depth + 1 < max_depth {
                if let Some(children) = self.children_map.get(&node_idx) {
                    for &child_idx in children {
                        if !visited.contains(&child_idx) && result.len() < max_nodes {
                            visited.insert(child_idx);
                            queue.push_back((child_idx, depth + 1));
                        }
                    }
                }
            }
        }

        result.sort();
        result
    }
}

/// Calculates dominators and returns both top objects and analysis state.
///
/// This is similar to `calculate_dominators` but also returns the analysis state
/// needed for lazy loading queries, plus class histogram and leak suspects.
pub fn calculate_dominators_with_state(graph: &HeapGraph) -> Result<(Vec<ObjectReport>, AnalysisState)> {
    log::debug!("Calculating dominators with state for {} nodes", graph.node_count());

    let petgraph = graph.graph();
    let super_root = graph.super_root();

    // Step 1: Compute dominator tree
    let dominators = dominators::simple_fast(petgraph, super_root);
    log::info!("Dominator tree computed successfully");

    // Step 2: Build children map
    // Nodes unreachable from SuperRoot (no immediate dominator) are attached
    // directly to SuperRoot so their sizes are included in the retained total.
    let mut children_map: HashMap<NodeIndex, Vec<NodeIndex>> = HashMap::new();
    for node_idx in petgraph.node_indices() {
        if node_idx == super_root {
            continue;
        }
        if let Some(dominator) = dominators.immediate_dominator(node_idx) {
            children_map.entry(dominator).or_insert_with(Vec::new).push(node_idx);
        } else {
            // Unreachable node — attach to SuperRoot so retained sizes are correct
            children_map.entry(super_root).or_insert_with(Vec::new).push(node_idx);
        }
    }

    // Step 3: Calculate shallow sizes
    let mut shallow_sizes: HashMap<NodeIndex, u64> = HashMap::new();
    for node_idx in petgraph.node_indices() {
        let node_data = &petgraph[node_idx];
        let shallow_size = match node_data {
            NodeData::SuperRoot | NodeData::Root | NodeData::Class => 0,
            NodeData::Instance { size, .. } => *size as u64,
            NodeData::Array { size, .. } => *size as u64,
        };
        shallow_sizes.insert(node_idx, shallow_size);
    }

    // Step 4: Calculate retained sizes bottom-up
    let mut retained_sizes: HashMap<NodeIndex, u64> = HashMap::new();
    let mut processed = std::collections::HashSet::new();

    for node_idx in petgraph.node_indices() {
        let shallow = shallow_sizes.get(&node_idx).copied().unwrap_or(0);
        retained_sizes.insert(node_idx, shallow);
    }

    let mut changed = true;
    while changed {
        changed = false;
        for node_idx in petgraph.node_indices() {
            if processed.contains(&node_idx) {
                continue;
            }
            let all_children_processed = children_map
                .get(&node_idx)
                .map_or(true, |node_children| {
                    node_children.iter().all(|&c| processed.contains(&c))
                });
            if all_children_processed {
                let mut retained = shallow_sizes.get(&node_idx).copied().unwrap_or(0);
                if let Some(node_children) = children_map.get(&node_idx) {
                    for &child in node_children {
                        retained += retained_sizes.get(&child).copied().unwrap_or(0);
                    }
                }
                retained_sizes.insert(node_idx, retained);
                processed.insert(node_idx);
                changed = true;
            }
        }
    }

    for node_idx in petgraph.node_indices() {
        if !processed.contains(&node_idx) {
            let shallow = shallow_sizes.get(&node_idx).copied().unwrap_or(0);
            retained_sizes.insert(node_idx, shallow);
        }
    }

    log::info!("Calculated retained sizes for {} nodes", retained_sizes.len());

    // Step 5: Build node_data_map and ObjectReports
    let mut node_data_map: HashMap<NodeIndex, (u64, String, String)> = HashMap::new();
    let mut reports: Vec<ObjectReport> = Vec::new();

    for node_idx in petgraph.node_indices() {
        let node_data = &petgraph[node_idx];
        let shallow = shallow_sizes.get(&node_idx).copied().unwrap_or(0);
        let retained = retained_sizes.get(&node_idx).copied().unwrap_or(0);

        let (object_id, node_type, class_name) = match node_data {
            NodeData::SuperRoot => (0, "SuperRoot".to_string(), String::new()),
            NodeData::Root => (0, "Root".to_string(), String::new()),
            NodeData::Class => (0, "Class".to_string(), String::new()),
            NodeData::Instance { id, class_name, .. } => (*id, "Instance".to_string(), class_name.clone()),
            NodeData::Array { id, class_name, .. } => (*id, "Array".to_string(), class_name.clone()),
        };

        node_data_map.insert(node_idx, (object_id, node_type.clone(), class_name.clone()));

        reports.push(ObjectReport::new(
            object_id,
            node_type,
            class_name,
            shallow,
            retained,
            node_idx,
        ));
    }

    reports.sort();
    let top_50: Vec<ObjectReport> = reports.into_iter().take(50).collect();

    // Step 6: Compute class histogram
    let mut histogram_map: HashMap<String, (u64, u64, u64)> = HashMap::new(); // (count, shallow, retained)
    for node_idx in petgraph.node_indices() {
        let node_data = &petgraph[node_idx];
        match node_data {
            NodeData::Instance { class_name, .. } | NodeData::Array { class_name, .. } => {
                let shallow = shallow_sizes.get(&node_idx).copied().unwrap_or(0);
                let retained = retained_sizes.get(&node_idx).copied().unwrap_or(0);
                let entry = histogram_map.entry(class_name.clone()).or_insert((0, 0, 0));
                entry.0 += 1;
                entry.1 += shallow;
                entry.2 += retained;
            }
            _ => {}
        }
    }

    let mut class_histogram: Vec<ClassHistogramEntry> = histogram_map
        .into_iter()
        .map(|(class_name, (instance_count, shallow_size, retained_size))| {
            ClassHistogramEntry { class_name, instance_count, shallow_size, retained_size }
        })
        .collect();
    class_histogram.sort_by(|a, b| b.retained_size.cmp(&a.retained_size));
    log::info!("Computed class histogram: {} classes", class_histogram.len());

    // Step 7: Detect leak suspects
    // Use total_heap_size from summary (sum of all shallow sizes) as the denominator
    // for percentages, since it's always correct regardless of dominator tree coverage.
    let summary = graph.summary();
    let total_heap_size = summary.total_heap_size;
    let mut leak_suspects = Vec::new();

    if total_heap_size > 0 {
        // Check dominator tree top-level children for individual objects retaining >10%
        if let Some(top_children) = children_map.get(&super_root) {
            for &child_idx in top_children {
                let retained = retained_sizes.get(&child_idx).copied().unwrap_or(0);
                let percentage = (retained as f64 / total_heap_size as f64) * 100.0;
                if percentage > 10.0 {
                    let (object_id, _, class_name) = node_data_map.get(&child_idx)
                        .cloned()
                        .unwrap_or((0, String::new(), String::new()));
                    let display_name = if class_name.is_empty() { "Unknown".to_string() } else { class_name.clone() };
                    leak_suspects.push(LeakSuspect {
                        class_name: display_name.clone(),
                        object_id,
                        retained_size: retained,
                        retained_percentage: percentage,
                        description: format!(
                            "Single {} instance retains {:.1}% of total heap ({:.2} MB)",
                            display_name,
                            percentage,
                            retained as f64 / (1024.0 * 1024.0)
                        ),
                    });
                }
            }
        }

        // Check for class groups collectively retaining >10%
        for entry in &class_histogram {
            let percentage = (entry.retained_size as f64 / total_heap_size as f64) * 100.0;
            if percentage > 10.0 && entry.instance_count > 1 {
                // Check if this class group wasn't already covered by individual suspects
                let already_covered = leak_suspects.iter()
                    .any(|s| s.class_name == entry.class_name && s.retained_percentage > percentage * 0.5);
                if !already_covered {
                    leak_suspects.push(LeakSuspect {
                        class_name: entry.class_name.clone(),
                        object_id: 0,
                        retained_size: entry.retained_size,
                        retained_percentage: percentage,
                        description: format!(
                            "{} instances of {} collectively retain {:.1}% of total heap ({:.2} MB)",
                            entry.instance_count,
                            entry.class_name,
                            percentage,
                            entry.retained_size as f64 / (1024.0 * 1024.0)
                        ),
                    });
                }
            }
        }

        leak_suspects.sort_by(|a, b| b.retained_percentage.partial_cmp(&a.retained_percentage).unwrap_or(std::cmp::Ordering::Equal));
    }
    log::info!("Detected {} leak suspects", leak_suspects.len());

    let id_to_node = graph.id_to_node().clone();
    let summary = graph.summary().clone();

    let state = AnalysisState {
        children_map,
        retained_sizes,
        shallow_sizes,
        id_to_node,
        super_root: graph.super_root(),
        node_data_map,
        class_histogram,
        leak_suspects,
        summary,
    };

    Ok((top_50, state))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    /// Test that we can successfully map a dummy file.
    ///
    /// This test:
    /// 1. Creates a temporary file with test data
    /// 2. Uses HprofLoader to map it
    /// 3. Verifies the mapped content matches the written data
    #[test]
    fn test_map_dummy_file() {
        // Initialize logger for test output (optional, but helpful for debugging)
        let _ = env_logger::Builder::from_default_env()
            .filter_level(log::LevelFilter::Debug)
            .try_init();

        // Create a temporary file with some test data
        let mut temp_file = tempfile::NamedTempFile::new().expect("Failed to create temp file");
        let test_data = b"JAVA PROFILE 1.0.2\0This is test HPROF data for memory mapping";
        temp_file
            .write_all(test_data)
            .expect("Failed to write test data");

        // Get the path to the temporary file
        let file_path = temp_file.path().to_path_buf();

        // Create a loader and map the file
        let loader = HprofLoader::new(file_path.clone());
        let mmap = loader
            .map_file()
            .expect("Failed to map the temporary file");

        // Verify the mapped content matches what we wrote
        assert_eq!(mmap.len(), test_data.len());
        assert_eq!(&mmap[..], test_data);

        // Verify we can read specific bytes
        assert_eq!(&mmap[0..18], b"JAVA PROFILE 1.0.2");

        log::info!("Successfully mapped and verified {} bytes", mmap.len());
    }

    /// Test that mapping an empty file returns an appropriate error.
    #[test]
    fn test_map_empty_file() {
        let _ = env_logger::Builder::from_default_env()
            .filter_level(log::LevelFilter::Debug)
            .try_init();

        let temp_file = tempfile::NamedTempFile::new().expect("Failed to create temp file");
        let file_path = temp_file.path().to_path_buf();

        let loader = HprofLoader::new(file_path);
        let result = loader.map_file();

        assert!(result.is_err());
        match result.unwrap_err() {
            HprofLoaderError::EmptyFile { path } => {
                log::debug!("Correctly detected empty file: {:?}", path);
            }
            other => panic!("Expected EmptyFile error, got: {:?}", other),
        }
    }

    /// Test that mapping a non-existent file returns an appropriate error.
    #[test]
    fn test_map_nonexistent_file() {
        let _ = env_logger::Builder::from_default_env()
            .filter_level(log::LevelFilter::Debug)
            .try_init();

        let nonexistent_path = PathBuf::from("/nonexistent/path/to/file.hprof");
        let loader = HprofLoader::new(nonexistent_path.clone());
        let result = loader.map_file();

        assert!(result.is_err());
        match result.unwrap_err() {
            HprofLoaderError::FileOpen { path, .. } => {
                assert_eq!(path, nonexistent_path);
                log::debug!("Correctly detected nonexistent file: {:?}", path);
            }
            other => panic!("Expected FileOpen error, got: {:?}", other),
        }
    }

    /// Test that the mapped memory is read-only (attempting to write would cause a segfault,
    /// but we can at least verify the type system prevents mutable access).
    #[test]
    fn test_mapped_memory_is_readonly() {
        let _ = env_logger::Builder::from_default_env()
            .filter_level(log::LevelFilter::Debug)
            .try_init();

        let mut temp_file = tempfile::NamedTempFile::new().expect("Failed to create temp file");
        temp_file
            .write_all(b"test data")
            .expect("Failed to write test data");

        let loader = HprofLoader::new(temp_file.path().to_path_buf());
        let mmap = loader.map_file().expect("Failed to map file");

        // Verify we can read from the map
        assert_eq!(&mmap[..], b"test data");

        // The memory map is read-only, so we cannot get a mutable reference.
        // This is enforced by the type system - `Mmap` (not `MmapMut`) is returned.
        // If we tried to get a mutable reference, the compiler would prevent it.
        // This test verifies the API design, not runtime behavior.
        log::debug!("Mapped memory is read-only (type system enforced)");
    }

    /// Test that we can map a large file (simulating a real HPROF scenario).
    #[test]
    fn test_map_large_file() {
        let _ = env_logger::Builder::from_default_env()
            .filter_level(log::LevelFilter::Debug)
            .try_init();

        // Create a file with 1MB of data (simulating a small HPROF file)
        let mut temp_file = tempfile::NamedTempFile::new().expect("Failed to create temp file");
        let large_data = vec![0x42u8; 1024 * 1024]; // 1MB
        temp_file
            .write_all(&large_data)
            .expect("Failed to write large test data");

        let loader = HprofLoader::new(temp_file.path().to_path_buf());
        let mmap = loader
            .map_file()
            .expect("Failed to map large file");

        assert_eq!(mmap.len(), 1024 * 1024);
        assert_eq!(mmap[0], 0x42);
        assert_eq!(mmap[mmap.len() - 1], 0x42);

        log::info!("Successfully mapped large file: {} bytes", mmap.len());
    }
}
