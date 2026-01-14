//! Async JSON-RPC server for HPROF analysis
//!
//! This server reads JSON-RPC requests from stdin and processes CPU-intensive
//! heap analysis tasks asynchronously using tokio blocking tasks.

use anyhow::{Context, Result};
use hprof_analyzer::{build_graph, calculate_dominators, HprofLoader};
use serde::{Deserialize, Serialize};
use std::io::{self, BufRead, BufReader, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
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
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

/// Server state and configuration.
struct Server {
    /// Counter for generating unique request IDs.
    request_id_counter: AtomicU64,
    /// Channel sender for sending analysis results.
    result_tx: mpsc::UnboundedSender<AnalyzeHeapResult>,
    /// Channel receiver for analysis results.
    result_rx: mpsc::UnboundedReceiver<AnalyzeHeapResult>,
}

impl Server {
    /// Creates a new server instance.
    fn new() -> Self {
        let (result_tx, result_rx) = mpsc::unbounded_channel();
        Self {
            request_id_counter: AtomicU64::new(1),
            result_tx,
            result_rx,
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

        // Clone the result sender for the blocking task
        let result_tx = self.result_tx.clone();
        let path_buf_clone = path_buf.clone();

        // Spawn blocking task for CPU-intensive work
        task::spawn_blocking(move || {
            let result = analyze_heap_blocking(path_buf_clone, request_id);

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
fn analyze_heap_blocking(path: PathBuf, request_id: u64) -> AnalyzeHeapResult {
    log::info!("Starting heap analysis for: {:?} (request_id: {})", path, request_id);

    match analyze_heap_internal(&path) {
        Ok(top_objects) => {
            log::info!("Heap analysis completed successfully (request_id: {})", request_id);
            AnalyzeHeapResult {
                request_id,
                status: "completed".to_string(),
                top_objects: Some(top_objects),
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
                error: Some(error_msg),
            }
        }
    }
}

/// Internal function that performs the actual heap analysis.
fn analyze_heap_internal(path: &PathBuf) -> Result<Vec<hprof_analyzer::ObjectReport>> {
    // Step 1: Load and map the HPROF file
    let loader = HprofLoader::new(path.clone());
    let mmap = loader.map_file()
        .with_context(|| format!("Failed to load HPROF file: {:?}", path))?;

    log::debug!("HPROF file mapped: {} bytes", mmap.len());

    // Step 2: Build the heap graph
    let graph = build_graph(&mmap[..])
        .context("Failed to build heap graph")?;

    log::debug!("Heap graph built: {} nodes, {} edges", 
                graph.node_count(), 
                graph.edge_count());

    // Step 3: Calculate dominators and retained sizes
    let top_objects = calculate_dominators(&graph)
        .context("Failed to calculate dominators")?;

    log::info!("Analysis complete: {} top objects", top_objects.len());

    Ok(top_objects)
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
    let result_tx = server.result_tx.clone();
    let mut result_rx = server.result_rx;

    // Spawn task to process results and send notifications
    let notification_handle = task::spawn(async move {
        let stdout = io::stdout();
        let mut stdout_lock = stdout.lock();
        
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

            if let Err(e) = writeln!(stdout_lock, "{}", json) {
                eprintln!("Failed to write notification: {}", e);
                break;
            }

            if let Err(e) = stdout_lock.flush() {
                eprintln!("Failed to flush stdout: {}", e);
                break;
            }
        }
    });

    // Spawn task to handle stdin reading and request processing
    let stdin_handle = task::spawn_blocking(move || {
        let stdin = io::stdin();
        let reader = BufReader::new(stdin.lock());
        let mut lines = Vec::new();

        for line_result in reader.lines() {
            let line = match line_result {
                Ok(line) => line,
                Err(e) => {
                    eprintln!("Failed to read line from stdin: {}", e);
                    break;
                }
            };

            if !line.is_empty() {
                lines.push(line);
            }
        }

        lines
    });

    // Handle stdin reading and process requests
    let request_handle = {
        let result_tx = server.result_tx.clone();
        let request_id_counter = server.request_id_counter.clone();
        task::spawn(async move {
            let stdin_result = stdin_handle.await;
            let lines = match stdin_result {
                Ok(lines) => lines,
                Err(e) => {
                    eprintln!("Error reading from stdin: {}", e);
                    return;
                }
            };

            let stdout = io::stdout();
            let mut stdout_lock = stdout.lock();

            // Process each line as a JSON-RPC request
            for line in lines {
                let request: JsonRpcRequest = match serde_json::from_str(&line) {
                    Ok(req) => req,
                    Err(e) => {
                        eprintln!("Failed to parse JSON-RPC request: {}", e);
                        continue;
                    }
                };

                // Handle analyze_heap requests
                if request.method == "analyze_heap" {
                    if let Err(e) = handle_analyze_heap_request(
                        request,
                        &result_tx,
                        &request_id_counter,
                        &mut stdout_lock,
                    ).await {
                        eprintln!("Error handling request: {}", e);
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
    request_id_counter: &AtomicU64,
    stdout: &mut io::StdoutLock<'_>,
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
    writeln!(stdout, "{}", json)
        .context("Failed to write processing response")?;
    stdout.flush().context("Failed to flush stdout")?;

    // Clone the result sender for the blocking task
    let result_tx = result_tx.clone();

    // Spawn blocking task for CPU-intensive work
    task::spawn_blocking(move || {
        let result = analyze_heap_blocking(path_buf, request_id);

        // Send result via channel (non-blocking)
        if let Err(e) = result_tx.send(result) {
            eprintln!("Failed to send analysis result: {}", e);
        }
    });

    Ok(())
}

