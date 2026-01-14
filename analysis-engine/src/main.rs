mod parser;

use analysis_engine::{JsonRpcRequest, JsonRpcResponse};
use std::io::{self, BufRead, BufReader, Write};

fn main() {
    let stdin = io::stdin();
    let stdout = io::stdout();
    let mut stdout_lock = stdout.lock();
    
    let reader = BufReader::new(stdin.lock());
    
    for line_result in reader.lines() {
        let line = match line_result {
            Ok(line) => line,
            Err(e) => {
                eprintln!("Failed to read line from stdin: {}", e);
                break;
            }
        };

        if line.is_empty() {
            continue;
        }

        let request: JsonRpcRequest = match serde_json::from_str(&line) {
            Ok(req) => req,
            Err(e) => {
                let error_response = JsonRpcResponse::error(
                    0,
                    -32700,
                    format!("Parse error: {}", e),
                    None,
                );
                if let Err(write_err) = write_response(&mut stdout_lock, &error_response) {
                    eprintln!("Failed to write error response: {}", write_err);
                    break;
                }
                continue;
            }
        };

        let response = handle_request(request);
        
        if let Err(e) = write_response(&mut stdout_lock, &response) {
            // Broken pipe or other write error - exit cleanly
            if e.kind() == io::ErrorKind::BrokenPipe {
                break;
            }
            eprintln!("Failed to write response: {}", e);
            break;
        }
    }
}

fn handle_request(request: JsonRpcRequest) -> JsonRpcResponse {
    match request.method.as_str() {
        "parse_hprof" => {
            let path = match extract_path(&request.params) {
                Ok(path) => path,
                Err(e) => {
                    return JsonRpcResponse::error(
                        request.id,
                        -32602,
                        format!("Invalid params: {}", e),
                        None,
                    );
                }
            };

            match parser::analyze_hprof(&path) {
                Ok(entries) => {
                    let result = serde_json::to_value(entries)
                        .unwrap_or_else(|_| serde_json::json!([]));
                    JsonRpcResponse::success(request.id, result)
                }
                Err(e) => {
                    JsonRpcResponse::error(
                        request.id,
                        -32000,
                        format!("HPROF parsing error: {}", e),
                        None,
                    )
                }
            }
        }
        _ => {
            JsonRpcResponse::error(
                request.id,
                -32601,
                format!("Method not found: {}", request.method),
                None,
            )
        }
    }
}

fn extract_path(params: &Option<serde_json::Value>) -> std::result::Result<String, String> {
    let params = params.as_ref().ok_or("Params missing")?;
    let path = params
        .get("path")
        .and_then(|v| v.as_str())
        .ok_or("Path parameter missing or invalid")?;
    Ok(path.to_string())
}

fn write_response<W: Write>(writer: &mut W, response: &JsonRpcResponse) -> io::Result<()> {
    let json = serde_json::to_string(response)
        .map_err(|e| io::Error::new(io::ErrorKind::Other, format!("JSON serialization error: {}", e)))?;
    writeln!(writer, "{}", json)?;
    writer.flush()?;
    Ok(())
}
