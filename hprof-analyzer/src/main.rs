//! Async JSON-RPC server and MCP server for HPROF analysis
//!
//! This server reads JSON-RPC requests from stdin and processes CPU-intensive
//! heap analysis tasks asynchronously using tokio blocking tasks.
//!
//! When run with `--mcp`, it operates as an MCP (Model Context Protocol) server
//! for use with AI clients like Claude Desktop.

use anyhow::{Context, Result};
use clap::Parser;
use hprof_analyzer::{build_graph, calculate_dominators_with_state, HprofLoader};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{self, BufRead, Write};
use std::path::PathBuf;
use std::sync::{Arc, RwLock};
use std::sync::atomic::{AtomicU64, Ordering};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::signal;
use tokio::sync::mpsc;
use tokio::task;

/// CLI arguments for hprof-server.
#[derive(Parser)]
#[command(name = "hprof-server", about = "HPROF heap dump analysis server")]
struct Cli {
    /// Run as an MCP (Model Context Protocol) server instead of JSON-RPC
    #[arg(long)]
    mcp: bool,
}

/// JSON-RPC 2.0 Request structure.
#[derive(Debug, Deserialize)]
struct JsonRpcRequest {
    #[allow(dead_code)]
    jsonrpc: String,
    id: Option<serde_json::Value>,
    method: String,
    params: Option<serde_json::Value>,
}

/// JSON-RPC 2.0 Notification structure (no id field).
#[derive(Debug, Serialize)]
struct JsonRpcNotification {
    jsonrpc: String,
    method: String,
    params: serde_json::Value,
}

/// Result of heap analysis.
#[derive(Debug, Serialize)]
struct AnalyzeHeapResult {
    request_id: u64,
    status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    top_objects: Option<Vec<hprof_analyzer::ObjectReport>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    top_layers: Option<Vec<hprof_analyzer::ObjectReport>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    summary: Option<hprof_analyzer::HeapSummary>,
    #[serde(skip_serializing_if = "Option::is_none")]
    class_histogram: Option<Vec<hprof_analyzer::ClassHistogramEntry>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    leak_suspects: Option<Vec<hprof_analyzer::LeakSuspect>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

/// Analysis state stored per file path.
#[derive(Clone)]
struct FileAnalysisState {
    /// The analysis state for querying children.
    state: Arc<RwLock<Option<hprof_analyzer::AnalysisState>>>,
    /// The file path this analysis is for.
    #[allow(dead_code)]
    path: PathBuf,
}

/// Performs the CPU-intensive heap analysis in a blocking task.
///
/// This function is meant to be called from `tokio::task::spawn_blocking`
/// to avoid blocking the async runtime.
fn analyze_heap_blocking(
    path: PathBuf,
    request_id: u64,
    analysis_states: Arc<RwLock<HashMap<PathBuf, FileAnalysisState>>>,
) -> AnalyzeHeapResult {
    log::info!("Starting heap analysis for: {:?} (request_id: {})", path, request_id);

    match analyze_heap_internal(&path, analysis_states.clone()) {
        Ok((top_objects, analysis_state)) => {
            log::info!("Heap analysis completed successfully (request_id: {})", request_id);

            let top_layers: Vec<_> = top_objects.iter()
                .filter(|obj| obj.retained_size > 0 && obj.node_type != "Class")
                .take(20)
                .cloned()
                .collect();

            AnalyzeHeapResult {
                request_id,
                status: "completed".to_string(),
                top_objects: Some(top_objects),
                top_layers: Some(top_layers),
                summary: Some(analysis_state.summary.clone()),
                class_histogram: Some(analysis_state.class_histogram.clone()),
                leak_suspects: Some(analysis_state.leak_suspects.clone()),
                error: None,
            }
        }
        Err(e) => {
            let error_msg = format!("Heap analysis failed: {}", e);
            log::error!("{} (request_id: {})", error_msg, request_id);
            AnalyzeHeapResult {
                request_id,
                status: "error".to_string(),
                top_objects: None,
                top_layers: None,
                summary: None,
                class_histogram: None,
                leak_suspects: None,
                error: Some(error_msg),
            }
        }
    }
}

/// Internal function that performs the actual heap analysis.
fn analyze_heap_internal(
    path: &PathBuf,
    analysis_states: Arc<RwLock<HashMap<PathBuf, FileAnalysisState>>>,
) -> Result<(Vec<hprof_analyzer::ObjectReport>, hprof_analyzer::AnalysisState)> {
    // Step 1: Load and map the HPROF file
    eprintln!("[Progress] Step 1/3: Loading HPROF file...");
    let loader = HprofLoader::new(path.clone());
    let mmap = loader.map_file()
        .with_context(|| format!("Failed to load HPROF file: {:?}", path))?;

    let file_size_mb = mmap.len() as f64 / (1024.0 * 1024.0);
    eprintln!("[Progress] HPROF file mapped: {:.2} MB", file_size_mb);
    log::info!("HPROF file mapped: {} bytes ({:.2} MB)", mmap.len(), file_size_mb);

    // Step 2: Build the heap graph
    eprintln!("[Progress] Step 2/3: Building heap graph (this may take a while for large files)...");
    let graph = build_graph(&mmap[..])
        .context("Failed to build heap graph")?;

    eprintln!("[Progress] Heap graph built: {} nodes, {} edges",
                graph.node_count(),
                graph.edge_count());
    log::info!("Heap graph built: {} nodes, {} edges",
                graph.node_count(),
                graph.edge_count());

    // Step 3: Calculate dominators and retained sizes with state
    eprintln!("[Progress] Step 3/3: Calculating dominators and retained sizes...");
    let (top_objects, analysis_state) = calculate_dominators_with_state(&graph)
        .context("Failed to calculate dominators")?;

    eprintln!("[Progress] Analysis complete: {} top objects", top_objects.len());
    log::info!("Analysis complete: {} top objects", top_objects.len());

    // Step 4: Store analysis state for lazy loading queries
    {
        let mut states = analysis_states.write()
            .map_err(|e| anyhow::anyhow!("Failed to write analysis states: {}", e))?;

        states.insert(path.clone(), FileAnalysisState {
            state: Arc::new(RwLock::new(Some(analysis_state.clone()))),
            path: path.clone(),
        });
    }

    log::debug!("Stored analysis state for: {:?}", path);

    Ok((top_objects, analysis_state))
}

/// Writes a JSON value to stdout followed by a newline, then flushes.
fn send_stdout(value: &serde_json::Value) -> Result<()> {
    let json = serde_json::to_string(value)
        .context("Failed to serialize JSON")?;
    let stdout = io::stdout();
    let mut stdout_lock = stdout.lock();
    writeln!(stdout_lock, "{}", json)
        .context("Failed to write to stdout")?;
    stdout_lock.flush().context("Failed to flush stdout")?;
    Ok(())
}

/// Formats a byte count into a human-readable string.
fn fmt_bytes(bytes: u64) -> String {
    if bytes == 0 {
        return "0 B".to_string();
    }
    let units = ["B", "KB", "MB", "GB"];
    let k = 1024_f64;
    let i = (bytes as f64).log(k).floor() as usize;
    let i = i.min(units.len() - 1);
    let val = bytes as f64 / k.powi(i as i32);
    if i > 1 {
        format!("{:.2} {}", val, units[i])
    } else {
        format!("{:.0} {}", val, units[i])
    }
}

// ============================================================================
// MCP Server
// ============================================================================

/// Returns the MCP tool definitions.
fn mcp_tool_definitions() -> serde_json::Value {
    serde_json::json!({
        "tools": [
            {
                "name": "analyze_heap",
                "description": "Analyze a Java heap dump (.hprof file). This must be called before using any other tools. The analysis may take 10-30 seconds for large files. Returns a summary with top objects, leak suspects, and class histogram.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "path": {
                            "type": "string",
                            "description": "Absolute path to the .hprof file"
                        }
                    },
                    "required": ["path"]
                }
            },
            {
                "name": "get_leak_suspects",
                "description": "Get detected memory leak suspects from a previously analyzed heap dump. Shows objects or classes retaining >10% of the heap.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "path": {
                            "type": "string",
                            "description": "Absolute path to the .hprof file (must have been analyzed first)"
                        }
                    },
                    "required": ["path"]
                }
            },
            {
                "name": "get_class_histogram",
                "description": "Get the class histogram showing instance counts, shallow sizes, and retained sizes per class. Useful for identifying which classes use the most memory.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "path": {
                            "type": "string",
                            "description": "Absolute path to the .hprof file (must have been analyzed first)"
                        },
                        "limit": {
                            "type": "integer",
                            "description": "Maximum number of entries to return (default: 30)"
                        }
                    },
                    "required": ["path"]
                }
            },
            {
                "name": "drill_down",
                "description": "Get the children of a specific object in the dominator tree. Use this to explore what an object retains. The object_id comes from previous analyze_heap or drill_down results.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "path": {
                            "type": "string",
                            "description": "Absolute path to the .hprof file (must have been analyzed first)"
                        },
                        "object_id": {
                            "type": "integer",
                            "description": "The object ID to drill into (from previous results)"
                        }
                    },
                    "required": ["path", "object_id"]
                }
            },
            {
                "name": "get_summary",
                "description": "Get heap summary statistics: total heap size, object count, class count, array count, and GC roots.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "path": {
                            "type": "string",
                            "description": "Absolute path to the .hprof file (must have been analyzed first)"
                        }
                    },
                    "required": ["path"]
                }
            }
        ]
    })
}

/// Gets the analysis state for a file path, returning an error text if not found.
fn get_analysis_state_for_path(
    analysis_states: &Arc<RwLock<HashMap<PathBuf, FileAnalysisState>>>,
    path: &str,
) -> std::result::Result<hprof_analyzer::AnalysisState, String> {
    let states = analysis_states.read()
        .map_err(|e| format!("Internal error: {}", e))?;
    let file_state = states.get(&PathBuf::from(path))
        .ok_or_else(|| format!("No analysis found for '{}'. Call analyze_heap first.", path))?;
    let state_guard = file_state.state.read()
        .map_err(|e| format!("Internal error: {}", e))?;
    state_guard.as_ref()
        .cloned()
        .ok_or_else(|| "Analysis state not available".to_string())
}

/// Formats the analyze_heap result as LLM-friendly markdown.
fn format_analyze_result(
    state: &hprof_analyzer::AnalysisState,
    top_objects: &[hprof_analyzer::ObjectReport],
) -> String {
    let s = &state.summary;
    let mut out = String::new();

    out.push_str("## Heap Summary\n\n");
    out.push_str(&format!("- **Total Heap Size:** {}\n", fmt_bytes(s.total_heap_size)));
    out.push_str(&format!("- **Objects:** {}\n", s.total_instances));
    out.push_str(&format!("- **Classes:** {}\n", s.total_classes));
    out.push_str(&format!("- **Arrays:** {}\n", s.total_arrays));
    out.push_str(&format!("- **GC Roots:** {}\n\n", s.total_gc_roots));

    // Top 20 objects
    let filtered: Vec<_> = top_objects.iter()
        .filter(|o| o.retained_size > 0 && o.node_type != "Class" && o.node_type != "SuperRoot")
        .take(20)
        .collect();

    if !filtered.is_empty() {
        out.push_str("## Top Objects by Retained Size\n\n");
        out.push_str("| # | Class | Type | Shallow | Retained |\n");
        out.push_str("|---|-------|------|---------|----------|\n");
        for (i, obj) in filtered.iter().enumerate() {
            let name = if obj.class_name.is_empty() { &obj.node_type } else { &obj.class_name };
            out.push_str(&format!("| {} | {} | {} | {} | {} |\n",
                i + 1, name, obj.node_type,
                fmt_bytes(obj.shallow_size), fmt_bytes(obj.retained_size)));
        }
        out.push('\n');
    }

    // Leak suspects
    if !state.leak_suspects.is_empty() {
        out.push_str("## Leak Suspects\n\n");
        for suspect in &state.leak_suspects {
            let severity = if suspect.retained_percentage > 30.0 { "HIGH" } else { "MEDIUM" };
            out.push_str(&format!("- **[{}] {}** - retains {:.1}% of heap ({}) - {}\n",
                severity, suspect.class_name, suspect.retained_percentage,
                fmt_bytes(suspect.retained_size), suspect.description));
        }
        out.push('\n');
    }

    // Top 10 histogram
    let hist_count = state.class_histogram.len().min(10);
    if hist_count > 0 {
        out.push_str("## Top Classes by Retained Size\n\n");
        out.push_str("| Class | Instances | Shallow | Retained |\n");
        out.push_str("|-------|-----------|---------|----------|\n");
        for entry in state.class_histogram.iter().take(hist_count) {
            out.push_str(&format!("| {} | {} | {} | {} |\n",
                entry.class_name, entry.instance_count,
                fmt_bytes(entry.shallow_size), fmt_bytes(entry.retained_size)));
        }
    }

    out
}

/// Formats leak suspects as markdown.
fn format_leak_suspects(suspects: &[hprof_analyzer::LeakSuspect]) -> String {
    if suspects.is_empty() {
        return "No leak suspects detected. No single object or class retains more than 10% of the heap.".to_string();
    }

    let mut out = String::from("## Leak Suspects\n\n");
    for (i, s) in suspects.iter().enumerate() {
        let severity = if s.retained_percentage > 30.0 { "HIGH" } else { "MEDIUM" };
        out.push_str(&format!("### {}. [{}] {}\n\n", i + 1, severity, s.class_name));
        out.push_str(&format!("- **Retained:** {} ({:.1}% of heap)\n", fmt_bytes(s.retained_size), s.retained_percentage));
        if s.object_id > 0 {
            out.push_str(&format!("- **Object ID:** {} (use `drill_down` to explore)\n", s.object_id));
        }
        out.push_str(&format!("- **Description:** {}\n\n", s.description));
    }
    out
}

/// Formats class histogram as markdown.
fn format_class_histogram(histogram: &[hprof_analyzer::ClassHistogramEntry], limit: usize) -> String {
    if histogram.is_empty() {
        return "No class histogram data available.".to_string();
    }

    let count = histogram.len().min(limit);
    let mut out = format!("## Class Histogram (top {} of {})\n\n", count, histogram.len());
    out.push_str("| # | Class | Instances | Shallow | Retained |\n");
    out.push_str("|---|-------|-----------|---------|----------|\n");
    for (i, entry) in histogram.iter().take(count).enumerate() {
        out.push_str(&format!("| {} | {} | {} | {} | {} |\n",
            i + 1, entry.class_name, entry.instance_count,
            fmt_bytes(entry.shallow_size), fmt_bytes(entry.retained_size)));
    }
    out
}

/// Formats drill-down children as markdown.
fn format_children(children: &[hprof_analyzer::ObjectReport], object_id: u64) -> String {
    if children.is_empty() {
        return format!("Object {} has no children in the dominator tree (leaf node).", object_id);
    }

    let mut out = format!("## Children of Object {} ({} entries)\n\n", object_id, children.len());
    out.push_str("| # | Class | Type | Object ID | Shallow | Retained |\n");
    out.push_str("|---|-------|------|-----------|---------|----------|\n");
    for (i, child) in children.iter().enumerate() {
        let name = if child.class_name.is_empty() { &child.node_type } else { &child.class_name };
        out.push_str(&format!("| {} | {} | {} | {} | {} | {} |\n",
            i + 1, name, child.node_type, child.object_id,
            fmt_bytes(child.shallow_size), fmt_bytes(child.retained_size)));
    }
    out.push_str("\nUse `drill_down` with any object_id above to explore deeper.");
    out
}

/// Formats heap summary as markdown.
fn format_summary(summary: &hprof_analyzer::HeapSummary) -> String {
    let mut out = String::from("## Heap Summary\n\n");
    out.push_str(&format!("- **Total Heap Size:** {}\n", fmt_bytes(summary.total_heap_size)));
    out.push_str(&format!("- **Total Objects (instances):** {}\n", summary.total_instances));
    out.push_str(&format!("- **Total Classes:** {}\n", summary.total_classes));
    out.push_str(&format!("- **Total Arrays:** {}\n", summary.total_arrays));
    out.push_str(&format!("- **GC Roots:** {}\n", summary.total_gc_roots));
    out
}

/// Makes an MCP tool result content block.
fn mcp_text_result(text: &str, is_error: bool) -> serde_json::Value {
    serde_json::json!({
        "content": [{ "type": "text", "text": text }],
        "isError": is_error
    })
}

/// Handles an MCP tools/call request.
fn handle_mcp_tool_call(
    tool_name: &str,
    arguments: &serde_json::Value,
    analysis_states: &Arc<RwLock<HashMap<PathBuf, FileAnalysisState>>>,
) -> serde_json::Value {
    match tool_name {
        "analyze_heap" => {
            let path = match arguments.get("path").and_then(|v| v.as_str()) {
                Some(p) => p,
                None => return mcp_text_result("Missing required parameter: path", true),
            };

            eprintln!("[MCP] analyze_heap: {}", path);
            match analyze_heap_internal(&PathBuf::from(path), analysis_states.clone()) {
                Ok((top_objects, state)) => {
                    let text = format_analyze_result(&state, &top_objects);
                    mcp_text_result(&text, false)
                }
                Err(e) => {
                    mcp_text_result(&format!("Analysis failed: {}", e), true)
                }
            }
        }
        "get_leak_suspects" => {
            let path = match arguments.get("path").and_then(|v| v.as_str()) {
                Some(p) => p,
                None => return mcp_text_result("Missing required parameter: path", true),
            };
            match get_analysis_state_for_path(analysis_states, path) {
                Ok(state) => mcp_text_result(&format_leak_suspects(&state.leak_suspects), false),
                Err(e) => mcp_text_result(&e, true),
            }
        }
        "get_class_histogram" => {
            let path = match arguments.get("path").and_then(|v| v.as_str()) {
                Some(p) => p,
                None => return mcp_text_result("Missing required parameter: path", true),
            };
            let limit = arguments.get("limit").and_then(|v| v.as_u64()).unwrap_or(30) as usize;
            match get_analysis_state_for_path(analysis_states, path) {
                Ok(state) => mcp_text_result(&format_class_histogram(&state.class_histogram, limit), false),
                Err(e) => mcp_text_result(&e, true),
            }
        }
        "drill_down" => {
            let path = match arguments.get("path").and_then(|v| v.as_str()) {
                Some(p) => p,
                None => return mcp_text_result("Missing required parameter: path", true),
            };
            let object_id = match arguments.get("object_id").and_then(|v| v.as_u64()) {
                Some(id) => id,
                None => return mcp_text_result("Missing required parameter: object_id", true),
            };
            match get_analysis_state_for_path(analysis_states, path) {
                Ok(state) => {
                    let children = state.get_children(object_id).unwrap_or_default();
                    mcp_text_result(&format_children(&children, object_id), false)
                }
                Err(e) => mcp_text_result(&e, true),
            }
        }
        "get_summary" => {
            let path = match arguments.get("path").and_then(|v| v.as_str()) {
                Some(p) => p,
                None => return mcp_text_result("Missing required parameter: path", true),
            };
            match get_analysis_state_for_path(analysis_states, path) {
                Ok(state) => mcp_text_result(&format_summary(&state.summary), false),
                Err(e) => mcp_text_result(&e, true),
            }
        }
        _ => {
            mcp_text_result(&format!("Unknown tool: {}", tool_name), true)
        }
    }
}

/// Runs the MCP server (synchronous stdin/stdout loop).
fn run_mcp_server() -> Result<()> {
    let analysis_states: Arc<RwLock<HashMap<PathBuf, FileAnalysisState>>> =
        Arc::new(RwLock::new(HashMap::new()));

    let stdin = io::stdin();
    let reader = stdin.lock();

    for line in reader.lines() {
        let line = match line {
            Ok(l) => l,
            Err(e) => {
                eprintln!("[MCP] Failed to read stdin: {}", e);
                break;
            }
        };

        if line.trim().is_empty() {
            continue;
        }

        let request: JsonRpcRequest = match serde_json::from_str(&line) {
            Ok(req) => req,
            Err(e) => {
                eprintln!("[MCP] Failed to parse request: {} (line: {})", e, line);
                continue;
            }
        };

        match request.method.as_str() {
            "initialize" => {
                if let Some(id) = &request.id {
                    let response = serde_json::json!({
                        "jsonrpc": "2.0",
                        "id": id,
                        "result": {
                            "protocolVersion": "2024-11-05",
                            "capabilities": {
                                "tools": {}
                            },
                            "serverInfo": {
                                "name": "heaplens",
                                "version": "0.1.0"
                            }
                        }
                    });
                    send_stdout(&response)?;
                }
            }
            "notifications/initialized" | "initialized" => {
                // No-op notification, no response needed
            }
            "tools/list" => {
                if let Some(id) = &request.id {
                    let tools = mcp_tool_definitions();
                    let response = serde_json::json!({
                        "jsonrpc": "2.0",
                        "id": id,
                        "result": tools
                    });
                    send_stdout(&response)?;
                }
            }
            "tools/call" => {
                if let Some(id) = &request.id {
                    let params = request.params.unwrap_or(serde_json::json!({}));
                    let tool_name = params.get("name").and_then(|v| v.as_str()).unwrap_or("");
                    let arguments = params.get("arguments").cloned().unwrap_or(serde_json::json!({}));

                    let result = handle_mcp_tool_call(tool_name, &arguments, &analysis_states);

                    let response = serde_json::json!({
                        "jsonrpc": "2.0",
                        "id": id,
                        "result": result
                    });
                    send_stdout(&response)?;
                }
            }
            _ => {
                // Unknown method
                if let Some(id) = &request.id {
                    let response = serde_json::json!({
                        "jsonrpc": "2.0",
                        "id": id,
                        "error": {
                            "code": -32601,
                            "message": format!("Method not found: {}", request.method)
                        }
                    });
                    send_stdout(&response)?;
                }
            }
        }
    }

    eprintln!("[MCP] Server shutdown");
    Ok(())
}

// ============================================================================
// JSON-RPC Server (existing extension mode)
// ============================================================================

/// Runs the JSON-RPC server for VS Code extension communication.
async fn run_jsonrpc_server() -> Result<()> {
    let (result_tx, mut result_rx) = mpsc::unbounded_channel::<AnalyzeHeapResult>();
    let request_id_counter = Arc::new(AtomicU64::new(1));
    let analysis_states: Arc<RwLock<HashMap<PathBuf, FileAnalysisState>>> =
        Arc::new(RwLock::new(HashMap::new()));

    // Spawn task to process results and send notifications
    let notification_handle = task::spawn(async move {
        while let Some(result) = result_rx.recv().await {
            let notification = JsonRpcNotification {
                jsonrpc: "2.0".to_string(),
                method: "heap_analysis_complete".to_string(),
                params: serde_json::to_value(&result).unwrap_or_else(|e| {
                    serde_json::json!({
                        "request_id": result.request_id,
                        "status": "error",
                        "error": format!("Failed to serialize result: {}", e)
                    })
                }),
            };

            let json = match serde_json::to_string(&notification) {
                Ok(json) => json,
                Err(e) => {
                    eprintln!("Failed to serialize notification: {}", e);
                    continue;
                }
            };

            // Lock stdout only for the write operation, not across await
            {
                let stdout = io::stdout();
                let mut stdout_lock = stdout.lock();
                if let Err(e) = writeln!(stdout_lock, "{}", json) {
                    eprintln!("Failed to write notification: {}", e);
                    break;
                }
                if let Err(e) = stdout_lock.flush() {
                    eprintln!("Failed to flush stdout: {}", e);
                    break;
                }
            }
        }
    });

    // Handle stdin reading and process requests line-by-line (async)
    let request_handle = {
        let result_tx = result_tx.clone();
        let request_id_counter = request_id_counter.clone();
        let analysis_states = analysis_states.clone();
        task::spawn(async move {
            let stdin = tokio::io::stdin();
            let reader = BufReader::new(stdin);
            let mut lines = reader.lines();

            // Process each line as it arrives (non-blocking)
            while let Some(line_result) = lines.next_line().await.transpose() {
                let line = match line_result {
                    Ok(line) => line,
                    Err(e) => {
                        eprintln!("Failed to read line from stdin: {}", e);
                        break;
                    }
                };

                if line.trim().is_empty() {
                    continue;
                }

                let request: JsonRpcRequest = match serde_json::from_str(&line) {
                    Ok(req) => req,
                    Err(e) => {
                        eprintln!("Failed to parse JSON-RPC request: {} (line: {})", e, line);
                        continue;
                    }
                };

                // Handle analyze_heap requests
                if request.method == "analyze_heap" {
                    if let Err(e) = handle_analyze_heap_request(
                        request,
                        &result_tx,
                        &request_id_counter,
                        &analysis_states,
                    ).await {
                        eprintln!("Error handling request: {}", e);
                    }
                } else if request.method == "get_children" {
                    if let Err(e) = handle_get_children_request(
                        request,
                        &analysis_states,
                    ).await {
                        eprintln!("Error handling get_children request: {}", e);
                    }
                } else if request.method == "export_json" {
                    if let Err(e) = handle_export_json_request(
                        request,
                        &analysis_states,
                    ).await {
                        eprintln!("Error handling export_json request: {}", e);
                    }
                } else {
                    // Unknown method - send error response
                    if let Some(id) = request.id {
                        let error_response = serde_json::json!({
                            "jsonrpc": "2.0",
                            "id": id,
                            "error": {
                                "code": -32601,
                                "message": format!("Method not found: {}", request.method)
                            }
                        });
                        if let Err(e) = send_stdout(&error_response) {
                            eprintln!("Failed to send error response: {}", e);
                            break;
                        }
                    }
                }
            }

            log::info!("Stdin closed, no more requests");
        })
    };

    // Wait for shutdown signal, stdin close, or notification completion
    tokio::select! {
        _ = signal::ctrl_c() => {
            log::info!("Received CTRL+C, shutting down...");
        }
        _ = request_handle => {
            log::info!("Stdin closed, waiting for remaining tasks...");
            // Give notifications time to finish
            tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
        }
        _ = notification_handle => {
            log::info!("All notifications sent");
        }
    }

    log::info!("Server shutdown complete");
    Ok(())
}

/// Handles an analyze_heap request without requiring the full Server struct.
async fn handle_analyze_heap_request(
    request: JsonRpcRequest,
    result_tx: &mpsc::UnboundedSender<AnalyzeHeapResult>,
    request_id_counter: &Arc<AtomicU64>,
    analysis_states: &Arc<RwLock<HashMap<PathBuf, FileAnalysisState>>>,
) -> Result<()> {
    // Extract parameters
    let params = request.params.ok_or_else(|| anyhow::anyhow!("Missing params"))?;
    let path = params
        .get("path")
        .and_then(|v| v.as_str())
        .ok_or_else(|| anyhow::anyhow!("Missing or invalid 'path' parameter"))?;
    let path_buf = PathBuf::from(path);

    let request_id = request.id
        .and_then(|v| v.as_u64())
        .unwrap_or_else(|| request_id_counter.fetch_add(1, Ordering::Relaxed));

    // Respond immediately with processing status
    let processing_response = serde_json::json!({
        "jsonrpc": "2.0",
        "id": request_id,
        "result": {
            "status": "processing",
            "request_id": request_id
        }
    });
    send_stdout(&processing_response)?;

    // Clone the result sender and analysis states for the blocking task
    let result_tx = result_tx.clone();
    let analysis_states = analysis_states.clone();

    // Spawn blocking task for CPU-intensive work
    task::spawn_blocking(move || {
        let result = analyze_heap_blocking(path_buf, request_id, analysis_states);

        // Send result via channel (non-blocking)
        if let Err(e) = result_tx.send(result) {
            eprintln!("Failed to send analysis result: {}", e);
        }
    });

    Ok(())
}

/// Handles a get_children request without requiring the full Server struct.
async fn handle_get_children_request(
    request: JsonRpcRequest,
    analysis_states: &Arc<RwLock<HashMap<PathBuf, FileAnalysisState>>>,
) -> Result<()> {
    // Extract parameters
    let params = request.params.ok_or_else(|| anyhow::anyhow!("Missing params"))?;
    let path = params
        .get("path")
        .and_then(|v| v.as_str())
        .ok_or_else(|| anyhow::anyhow!("Missing or invalid 'path' parameter"))?;
    let object_id = params
        .get("object_id")
        .and_then(|v| v.as_u64())
        .ok_or_else(|| anyhow::anyhow!("Missing or invalid 'object_id' parameter"))?;

    let request_id = request.id.ok_or_else(|| anyhow::anyhow!("Request ID required"))?;

    // Get analysis state for this file
    let analysis_states_guard = analysis_states.read()
        .map_err(|e| anyhow::anyhow!("Failed to read analysis states: {}", e))?;

    let file_state = analysis_states_guard.get(&PathBuf::from(path))
        .ok_or_else(|| anyhow::anyhow!("No analysis found for file: {}", path))?;

    let state_guard = file_state.state.read()
        .map_err(|e| anyhow::anyhow!("Failed to read analysis state: {}", e))?;

    let analysis_state = state_guard.as_ref()
        .ok_or_else(|| anyhow::anyhow!("Analysis state not available"))?;

    // Get children — return empty array if node not found or has no children
    let children = analysis_state.get_children(object_id).unwrap_or_default();
    let response = serde_json::json!({
        "jsonrpc": "2.0",
        "id": request_id,
        "result": children
    });
    send_stdout(&response)?;

    Ok(())
}

/// Handles an export_json request.
async fn handle_export_json_request(
    request: JsonRpcRequest,
    analysis_states: &Arc<RwLock<HashMap<PathBuf, FileAnalysisState>>>,
) -> Result<()> {
    let params = request.params.ok_or_else(|| anyhow::anyhow!("Missing params"))?;
    let path = params
        .get("path")
        .and_then(|v| v.as_str())
        .ok_or_else(|| anyhow::anyhow!("Missing or invalid 'path' parameter"))?;
    let output_path = params
        .get("output_path")
        .and_then(|v| v.as_str())
        .ok_or_else(|| anyhow::anyhow!("Missing or invalid 'output_path' parameter"))?;

    let request_id = request.id.ok_or_else(|| anyhow::anyhow!("Request ID required"))?;

    let analysis_states_guard = analysis_states.read()
        .map_err(|e| anyhow::anyhow!("Failed to read analysis states: {}", e))?;

    let file_state = analysis_states_guard.get(&PathBuf::from(path))
        .ok_or_else(|| anyhow::anyhow!("No analysis found for file: {}", path))?;

    let state_guard = file_state.state.read()
        .map_err(|e| anyhow::anyhow!("Failed to read analysis state: {}", e))?;

    let analysis_state = state_guard.as_ref()
        .ok_or_else(|| anyhow::anyhow!("Analysis state not available"))?;

    // Build export data
    let top_objects = analysis_state.get_top_layers(3, 100);

    let export_data = serde_json::json!({
        "source_file": path,
        "summary": analysis_state.summary,
        "class_histogram": analysis_state.class_histogram,
        "leak_suspects": analysis_state.leak_suspects,
        "top_objects": top_objects,
    });

    // Write to file
    let export_json = serde_json::to_string_pretty(&export_data)
        .context("Failed to serialize export data")?;
    std::fs::write(output_path, export_json)
        .context("Failed to write export file")?;

    let response = serde_json::json!({
        "jsonrpc": "2.0",
        "id": request_id,
        "result": { "success": true }
    });
    send_stdout(&response)?;

    Ok(())
}

#[tokio::main]
async fn main() -> Result<()> {
    // Initialize logging
    env_logger::Builder::from_default_env()
        .filter_level(log::LevelFilter::Info)
        .init();

    let cli = Cli::parse();

    if cli.mcp {
        log::info!("Starting HeapLens MCP server");
        run_mcp_server()
    } else {
        log::info!("Starting HPROF analysis server (JSON-RPC mode)");
        run_jsonrpc_server().await
    }
}
