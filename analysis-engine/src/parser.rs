use anyhow::{Context, Result};
use jvm_hprof::{parse_hprof, RecordTag};
use memmap2::Mmap;
use std::collections::HashMap;
use std::fs::File;

use analysis_engine::HistogramEntry;

pub fn analyze_hprof(path: &str) -> Result<Vec<HistogramEntry>> {
    let file = File::open(path)
        .with_context(|| format!("Failed to open HPROF file: {}", path))?;
    
    let mmap = unsafe { Mmap::map(&file) }
        .with_context(|| "Failed to memory-map HPROF file")?;

    // Parse the HPROF file using jvm-hprof
    let hprof = parse_hprof(&mmap[..])
        .map_err(|e| anyhow::anyhow!("Failed to parse HPROF file: {:?}", e))?;

    // First pass: map ClassId -> ClassName
    // Build string ID to string mapping
    let mut string_map: HashMap<u64, String> = HashMap::new();
    let mut class_map: HashMap<u64, String> = HashMap::new();

    // Collect all UTF-8 string records
    for record_result in hprof.records_iter() {
        let record = record_result.map_err(|e| anyhow::anyhow!("Failed to parse record: {:?}", e))?;
        
        if record.tag() == RecordTag::Utf8 {
            if let Some(utf8_result) = record.as_utf_8() {
                let utf8 = utf8_result.map_err(|e| anyhow::anyhow!("Failed to parse UTF-8 record: {:?}", e))?;
                let text = utf8.text_as_str()
                    .unwrap_or("<invalid-utf8>")
                    .to_string();
                string_map.insert(utf8.name_id().id(), text);
            }
        }
    }

    // Collect class definitions and map to class names
    for record_result in hprof.records_iter() {
        let record = record_result.map_err(|e| anyhow::anyhow!("Failed to parse record: {:?}", e))?;
        
        if record.tag() == RecordTag::LoadClass {
            if let Some(load_class_result) = record.as_load_class() {
                let load_class = load_class_result.map_err(|e| anyhow::anyhow!("Failed to parse LoadClass record: {:?}", e))?;
                let class_id = load_class.class_obj_id().id();
                let class_name_id = load_class.class_name_id().id();
                
                if let Some(class_name) = string_map.get(&class_name_id) {
                    class_map.insert(class_id, class_name.clone());
                }
            }
        }
    }

    // Second pass: count instances per class
    let mut instance_counts: HashMap<u64, u64> = HashMap::new();
    let mut instance_sizes: HashMap<u64, u64> = HashMap::new();

    for record_result in hprof.records_iter() {
        let record = record_result.map_err(|e| anyhow::anyhow!("Failed to parse record: {:?}", e))?;
        
        if record.tag() == RecordTag::HeapDump || record.tag() == RecordTag::HeapDumpSegment {
            if let Some(heap_dump_result) = record.as_heap_dump_segment() {
                let heap_dump = heap_dump_result.map_err(|e| anyhow::anyhow!("Failed to parse HeapDumpSegment: {:?}", e))?;
                
                // Iterate over sub-records in the heap dump segment
                for sub_record_result in heap_dump.sub_records() {
                    let sub_record = sub_record_result.map_err(|e| anyhow::anyhow!("Failed to parse sub-record: {:?}", e))?;
                    
                    if let jvm_hprof::heap_dump::SubRecord::Instance(instance) = sub_record {
                        let class_id = instance.class_obj_id().id();
                        *instance_counts.entry(class_id).or_insert(0) += 1;
                        
                        // Note: Instance size is not directly available in the jvm-hprof API
                        // We'll set shallow_size to 0 for now, or it could be calculated
                        // from class field definitions if needed
                        *instance_sizes.entry(class_id).or_insert(0) += 0;
                    }
                }
            }
        }
    }

    // Build histogram entries
    let mut entries: Vec<HistogramEntry> = instance_counts
        .into_iter()
        .map(|(class_id, count)| {
            let class_name = class_map
                .get(&class_id)
                .cloned()
                .unwrap_or_else(|| format!("UnknownClass_{}", class_id));
            let shallow_size = instance_sizes.get(&class_id).copied().unwrap_or(0);
            
            HistogramEntry {
                class_name,
                count,
                shallow_size,
            }
        })
        .collect();

    // Sort descending by count
    entries.sort_by(|a, b| b.count.cmp(&a.count));

    Ok(entries)
}
