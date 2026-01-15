//! Async JSON-RPC server for HPROF analysis
//!
//! This server reads JSON-RPC requests from stdin and processes CPU-intensive
//! heap analysis tasks asynchronously using tokio blocking tasks.

use anyhow::{Context, Result};
use hprof_analyzer::{build_graph, calculate_dominators_with_state, HprofLoader};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{self, Write};
use std::path::PathBuf;
use std::sync::{Arc, RwLock};
use std::sync::atomic::{AtomicU64, Ordering};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::signal;
use tokio::sync::mpsc;
use tokio::task;

/// JSON-RPC 2.0 Request structure.
#[derive(Debug, Deserialize)]
struct JsonRpcRequest {
    jsonrpc: String,
    id: Option<u64>,
    method: String,
    params: Option<serde_json::Value>,
}

/// JSON-RPC 2.0 Response structure.
#[derive(Debug, Serialize)]
struct JsonRpcResponse {
    jsonrpc: String,
    id: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<JsonRpcError>,
}

/// JSON-RPC 2.0 Error structure.
#[derive(Debug, Serialize)]
struct JsonRpcError {
    code: i32,
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    data: Option<serde_json::Value>,
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
    /// Top 2 layers of the dominator tree for initial visualization.
    #[serde(skip_serializing_if = "Option::is_none")]
    top_layers: Option<Vec<hprof_analyzer::ObjectReport>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

/// Analysis state stored per file path.
#[derive(Clone)]
struct FileAnalysisState {
    /// The analysis state for querying children.
    state: Arc<RwLock<Option<hprof_analyzer::AnalysisState>>>,
    /// The file path this analysis is for.
    path: PathBuf,
}

/// Server state and configuration.
struct Server {
    /// Counter for generating unique request IDs.
    request_id_counter: Arc<AtomicU64>,
    /// Channel sender for sending analysis results.
    result_tx: mpsc::UnboundedSender<AnalyzeHeapResult>,
    /// Channel receiver for analysis results.
    result_rx: mpsc::UnboundedReceiver<AnalyzeHeapResult>,
    /// Stored analysis states keyed by file path.
    analysis_states: Arc<RwLock<HashMap<PathBuf, FileAnalysisState>>>,
}

impl Server {
    /// Creates a new server instance.
    fn new() -> Self {
        let (result_tx, result_rx) = mpsc::unbounded_channel();
        Self {
            request_id_counter: Arc::new(AtomicU64::new(1)),
            result_tx,
            result_rx,
            analysis_states: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// Generates a new unique request ID.
    fn next_request_id(&self) -> u64 {
        self.request_id_counter.fetch_add(1, Ordering::Relaxed)
    }

    /// Handles a JSON-RPC request.
    async fn handle_request(&self, request: JsonRpcRequest, stdout: &mut io::StdoutLock<'_>) -> Result<()> {
        match request.method.as_str() {
            "analyze_heap" => {
                self.handle_analyze_heap(request, stdout).await?;
            }
            "get_children" => {
                self.handle_get_children(request, stdout).await?;
            }
            _ => {
                // Unknown method - send error response
                if let Some(id) = request.id {
                    let error_response = JsonRpcResponse {
                        jsonrpc: "2.0".to_string(),
                        id,
                        result: None,
                        error: Some(JsonRpcError {
                            code: -32601,
                            message: format!("Method not found: {}", request.method),
                            data: None,
                        }),
                    };
                    self.send_response(stdout, &error_response)?;
                }
            }
        }
        Ok(())
    }

    /// Handles the analyze_heap request.
    async fn handle_analyze_heap(
        &self,
        request: JsonRpcRequest,
        stdout: &mut io::StdoutLock<'_>,
    ) -> Result<()> {
        // Extract parameters
        let params = request.params.ok_or_else(|| anyhow::anyhow!("Missing params"))?;
        let path = params
            .get("path")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("Missing or invalid 'path' parameter"))?;
        let path_buf = PathBuf::from(path);

        let request_id = request.id.unwrap_or_else(|| self.next_request_id());

        // Respond immediately with processing status
        let processing_response = JsonRpcResponse {
            jsonrpc: "2.0".to_string(),
            id: request_id,
            result: Some(serde_json::json!({
                "status": "processing",
                "request_id": request_id
            })),
            error: None,
        };
        self.send_response(stdout, &processing_response)?;

        // Clone the result sender and analysis states for the blocking task
        let result_tx = self.result_tx.clone();
        let analysis_states = self.analysis_states.clone();
        let path_buf_clone = path_buf.clone();

        // Spawn blocking task for CPU-intensive work
        task::spawn_blocking(move || {
            let result = analyze_heap_blocking(path_buf_clone.clone(), request_id, analysis_states);

            // Send result via channel (non-blocking)
            if let Err(e) = result_tx.send(result) {
                eprintln!("Failed to send analysis result: {}", e);
            }
        });

        Ok(())
    }

    /// Sends a JSON-RPC response to stdout.
    fn send_response(&self, stdout: &mut io::StdoutLock<'_>, response: &JsonRpcResponse) -> Result<()> {
        let json = serde_json::to_string(response)
            .context("Failed to serialize JSON-RPC response")?;
        writeln!(stdout, "{}", json)
            .context("Failed to write response to stdout")?;
        stdout.flush().context("Failed to flush stdout")?;
        Ok(())
    }

    /// Handles the get_children request.
    async fn handle_get_children(
        &self,
        request: JsonRpcRequest,
        stdout: &mut io::StdoutLock<'_>,
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
        let analysis_states = self.analysis_states.read()
            .map_err(|e| anyhow::anyhow!("Failed to read analysis states: {}", e))?;
        
        let file_state = analysis_states.get(&PathBuf::from(path))
            .ok_or_else(|| anyhow::anyhow!("No analysis found for file: {}", path))?;

        let state_guard = file_state.state.read()
            .map_err(|e| anyhow::anyhow!("Failed to read analysis state: {}", e))?;

        let analysis_state = state_guard.as_ref()
            .ok_or_else(|| anyhow::anyhow!("Analysis state not available"))?;

        // Get children
        match analysis_state.get_children(object_id) {
            Some(children) => {
                let response = JsonRpcResponse {
                    jsonrpc: "2.0".to_string(),
                    id: request_id,
                    result: Some(serde_json::to_value(children)?),
                    error: None,
                };
                self.send_response(stdout, &response)?;
            }
            None => {
                let error_response = JsonRpcResponse {
                    jsonrpc: "2.0".to_string(),
                    id: request_id,
                    result: None,
                    error: Some(JsonRpcError {
                        code: -32000,
                        message: format!("Node not found or has no children: object_id={}", object_id),
                        data: None,
                    }),
                };
                self.send_response(stdout, &error_response)?;
            }
        }

        Ok(())
    }

    /// Sends a JSON-RPC notification to stdout.
    fn send_notification(&self, stdout: &mut io::StdoutLock<'_>, notification: &JsonRpcNotification) -> Result<()> {
        let json = serde_json::to_string(notification)
            .context("Failed to serialize JSON-RPC notification")?;
        writeln!(stdout, "{}", json)
            .context("Failed to write notification to stdout")?;
        stdout.flush().context("Failed to flush stdout")?;
        Ok(())
    }

    /// Processes results from the result channel and sends notifications.
    async fn process_results(&mut self, stdout: &mut io::StdoutLock<'_>) {
        while let Some(result) = self.result_rx.recv().await {
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

            if let Err(e) = self.send_notification(stdout, &notification) {
                eprintln!("Failed to send notification: {}", e);
            }
        }
    }
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
            
            // Get top objects for initial visualization (filtered to meaningful objects)
            // Use top_objects directly, but limit to top 20 for better visualization
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

#[tokio::main]
async fn main() -> Result<()> {
    // Initialize logging
    env_logger::Builder::from_default_env()
        .filter_level(log::LevelFilter::Info)
        .init();

    log::info!("Starting HPROF analysis server");

    // Create server instance
    let server = Server::new();
    let mut result_rx = server.result_rx;

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
        let result_tx = server.result_tx.clone();
        let request_id_counter = server.request_id_counter.clone();
        let analysis_states = server.analysis_states.clone();
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
                    // Handle get_children requests
                    if let Err(e) = handle_get_children_request(
                        request,
                        &analysis_states,
                    ).await {
                        eprintln!("Error handling get_children request: {}", e);
                    }
                } else {
                    // Unknown method - send error response
                    if let Some(id) = request.id {
                        let error_response = JsonRpcResponse {
                            jsonrpc: "2.0".to_string(),
                            id,
                            result: None,
                            error: Some(JsonRpcError {
                                code: -32601,
                                message: format!("Method not found: {}", request.method),
                                data: None,
                            }),
                        };
                        let json = match serde_json::to_string(&error_response) {
                            Ok(json) => json,
                            Err(e) => {
                                eprintln!("Failed to serialize error response: {}", e);
                                continue;
                            }
                        };
                        // Lock stdout only for the write operation
                        {
                            let stdout = io::stdout();
                            let mut stdout_lock = stdout.lock();
                            if let Err(e) = writeln!(stdout_lock, "{}", json) {
                                eprintln!("Failed to write error response: {}", e);
                                break;
                            }
                            if let Err(e) = stdout_lock.flush() {
                                eprintln!("Failed to flush stdout: {}", e);
                                break;
                            }
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

    let request_id = request.id.unwrap_or_else(|| request_id_counter.fetch_add(1, Ordering::Relaxed));

    // Respond immediately with processing status
    let processing_response = JsonRpcResponse {
        jsonrpc: "2.0".to_string(),
        id: request_id,
        result: Some(serde_json::json!({
            "status": "processing",
            "request_id": request_id
        })),
        error: None,
    };
    
    let json = serde_json::to_string(&processing_response)
        .context("Failed to serialize processing response")?;
    
    // Lock stdout only for the write, then release immediately
    {
        let stdout = io::stdout();
        let mut stdout_lock = stdout.lock();
        writeln!(stdout_lock, "{}", json)
            .context("Failed to write processing response")?;
        stdout_lock.flush().context("Failed to flush stdout")?;
    }

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

    // Get children
    let response = match analysis_state.get_children(object_id) {
        Some(children) => {
            JsonRpcResponse {
                jsonrpc: "2.0".to_string(),
                id: request_id,
                result: Some(serde_json::to_value(children)?),
                error: None,
            }
        }
        None => {
            JsonRpcResponse {
                jsonrpc: "2.0".to_string(),
                id: request_id,
                result: None,
                error: Some(JsonRpcError {
                    code: -32000,
                    message: format!("Node not found or has no children: object_id={}", object_id),
                    data: None,
                }),
            }
        }
    };

    let json = serde_json::to_string(&response)
        .context("Failed to serialize get_children response")?;
    
    // Lock stdout only for the write, then release immediately
    {
        let stdout = io::stdout();
        let mut stdout_lock = stdout.lock();
        writeln!(stdout_lock, "{}", json)
            .context("Failed to write get_children response")?;
        stdout_lock.flush().context("Failed to flush stdout")?;
    }

    Ok(())
}
