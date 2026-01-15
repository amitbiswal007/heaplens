# Testing Guide

This guide covers how to build, test, and debug the HeapScope VS Code extension.

## Prerequisites

1. **Rust and Cargo**: Required for building the analysis server
   ```bash
   # Check if installed
   rustc --version
   cargo --version
   
   # If not installed, install from https://rustup.rs/
   ```

2. **Node.js and npm**: Required for the VS Code extension
   ```bash
   # Check if installed
   node --version
   npm --version
   ```

3. **VS Code**: For running the extension in development mode

4. **HPROF File**: A Java heap dump file (`.hprof`) for testing
   - You can generate one from a Java application using:
     ```bash
     jmap -dump:format=b,file=heap.hprof <pid>
     ```
   - Or use any existing `.hprof` file

## Build Steps

### 1. Build the Rust Analysis Server

```bash
# Navigate to the hprof-analyzer directory
cd hprof-analyzer

# Build in release mode (optimized)
cargo build --release

# The binary will be at:
# hprof-analyzer/target/release/hprof-server
# (or hprof-server.exe on Windows)
```

**Expected output:**
```
   Compiling hprof-analyzer v0.1.0
   ...
   Finished release [optimized] target(s) in X.XXs
```

### 2. Build the VS Code Extension

```bash
# From the project root
npm install

# Compile TypeScript
npm run compile

# The compiled JavaScript will be in the `out/` directory
```

**Expected output:**
```
> heap-analyzer@0.0.1 compile
> tsc -p ./

(No errors)
```

### 3. Verify Binary Path

The extension looks for the Rust server binary in two locations:

1. **Production path**: `bin/hprof-server` (or `.exe` on Windows)
2. **Development path**: `hprof-analyzer/target/release/hprof-server`

For testing, the development path should work automatically. If you want to use the production path:

```bash
# Create bin directory (if it doesn't exist)
mkdir -p bin

# Copy the binary
cp hprof-analyzer/target/release/hprof-server bin/
# On Windows:
# copy hprof-analyzer\target\release\hprof-server.exe bin\
```

## Testing the Extension

### Method 1: Extension Development Host (Recommended)

1. **Open the project in VS Code**
   
   **Option A: If `code` command is available:**
   ```bash
   code .
   ```
   
   **Option B: If `code` command is not found, install VS Code command line tools:**
   - Open VS Code
   - Press `Cmd+Shift+P` (Command Palette)
   - Type "Shell Command: Install 'code' command in PATH"
   - Select it and restart your terminal
   
   **Option C: Open VS Code manually:**
   - Open VS Code application
   - File → Open Folder
   - Navigate to the project directory: `/Users/sachingupta/Documents/Learning/Cursor/sachinkg12/HeapScope/HeapScope`

2. **Press F5** (or Run → Start Debugging)
   - This opens a new "Extension Development Host" window
   - The extension is loaded in this window

3. **In the Extension Development Host window:**
   - Press `Cmd+Shift+P` (Mac) or `Ctrl+Shift+P` (Windows/Linux)
   - Type "Analyze HPROF File"
   - Select the command
   - Choose an `.hprof` file from the file picker

4. **Expected behavior:**
   - Progress notification appears: "Analyzing HPROF File"
   - Output channel "Heap Analyzer" opens showing progress
   - After analysis completes:
     - Success message: "HPROF analysis completed: X objects analyzed"
     - Webview panel opens with Sunburst chart
     - Output channel shows top objects

### Method 2: Manual Testing of Rust Server

Test the Rust server independently:

```bash
# Start the server (reads from stdin, writes to stdout)
cd hprof-analyzer
./target/release/hprof-server

# In another terminal, send a test request
echo '{"jsonrpc":"2.0","id":1,"method":"analyze_heap","params":{"path":"/path/to/heap.hprof"}}' | ./target/release/hprof-server
```

**Expected output:**
1. Immediate response:
   ```json
   {"jsonrpc":"2.0","id":1,"result":{"status":"processing","request_id":1}}
   ```

2. After analysis completes, notification:
   ```json
   {"jsonrpc":"2.0","method":"heap_analysis_complete","params":{"request_id":1,"status":"completed","top_objects":[...],"top_layers":[...]}}
   ```

### Method 3: Test get_children RPC

After an analysis completes, test the `get_children` method:

```bash
# Start server
./target/release/hprof-server

# Send analyze_heap request (wait for completion)
echo '{"jsonrpc":"2.0","id":1,"method":"analyze_heap","params":{"path":"/path/to/heap.hprof"}}' > /tmp/request.txt
cat /tmp/request.txt | ./target/release/hprof-server > /tmp/response.txt

# Wait for analysis to complete, then send get_children
echo '{"jsonrpc":"2.0","id":2,"method":"get_children","params":{"path":"/path/to/heap.hprof","object_id":0}}' | ./target/release/hprof-server
```

**Expected response:**
```json
{"jsonrpc":"2.0","id":2,"result":[{"object_id":123,"node_type":"Instance","shallow_size":1024,"retained_size":1048576,...},...]}
```

## Testing Scenarios

### Scenario 1: Basic Analysis Flow

1. ✅ Open Extension Development Host (F5)
2. ✅ Run "Analyze HPROF File" command
3. ✅ Select an HPROF file
4. ✅ Verify progress bar appears
5. ✅ Verify output channel shows progress
6. ✅ Verify webview opens with Sunburst chart
7. ✅ Verify chart displays top 2 layers

### Scenario 2: Drill-Down Interaction

1. ✅ Click on a slice in the Sunburst chart
2. ✅ Verify tooltip shows node details
3. ✅ Verify `get_children` request is sent
4. ✅ Verify chart updates with children
5. ✅ Verify smooth transition animation

### Scenario 3: Error Handling

1. ✅ Test with invalid file path
   - Should show error message
   - Should not crash

2. ✅ Test with corrupted HPROF file
   - Should show error message
   - Should handle gracefully

3. ✅ Test with missing Rust binary
   - Should show error: "Rust server binary not found"
   - Should provide helpful path information

### Scenario 4: Multiple Files

1. ✅ Analyze first HPROF file
2. ✅ Analyze second HPROF file
3. ✅ Verify each analysis is independent
4. ✅ Verify state is stored per file path

## Debugging

### Debug the Extension

1. **Set breakpoints** in TypeScript files:
   - `src/extension.ts`
   - `src/rustClient.ts`
   - `src/webviewProvider.ts`

2. **Press F5** to start debugging
   - Breakpoints will hit in the Extension Development Host

3. **View logs**:
   - Output channel: "Heap Analyzer"
   - Debug console in VS Code

### Debug the Rust Server

1. **Add logging**:
   ```rust
   log::debug!("Debug message: {:?}", variable);
   ```

2. **Set log level**:
   ```bash
   RUST_LOG=debug ./target/release/hprof-server
   ```

3. **Use a debugger**:
   ```bash
   # Install lldb (Mac) or gdb (Linux)
   lldb ./target/release/hprof-server
   # or
   gdb ./target/release/hprof-server
   ```

### Debug the Webview

1. **Open Developer Tools**:
   - In the Extension Development Host window
   - Right-click in the webview panel
   - Select "Inspect" or "Inspect Element"
   - Or use Command Palette: "Developer: Open Webview Developer Tools"

2. **Console logs**:
   - Check browser console for JavaScript errors
   - Add `console.log()` statements in webview HTML

3. **Network requests**:
   - Check Network tab for message passing
   - Verify `postMessage` calls

## Common Issues and Solutions

### Issue: "Rust server binary not found"

**Solution:**
- Verify binary exists: `ls hprof-analyzer/target/release/hprof-server`
- Check file permissions: `chmod +x hprof-analyzer/target/release/hprof-server`
- Copy to `bin/` directory if needed

### Issue: "Failed to spawn Rust process"

**Solution:**
- Check if binary is executable
- Verify path is correct
- Check for missing dependencies (libc, etc.)

### Issue: Webview doesn't open

**Solution:**
- Check Output channel for errors
- Verify `top_layers` data is being sent
- Check browser console in webview developer tools
- Verify D3.js and React CDN URLs are accessible

### Issue: Chart doesn't update on click

**Solution:**
- Check browser console for JavaScript errors
- Verify `get_children` RPC is being called
- Check Rust server logs for errors
- Verify analysis state is stored correctly

### Issue: Analysis times out

**Solution:**
- Check HPROF file size (very large files may take time)
- Increase timeout in `src/extension.ts` (currently 5 minutes)
- Check system resources (memory, CPU)
- Verify Rust server is not stuck

## Performance Testing

### Large HPROF Files

Test with various file sizes:

1. **Small (< 100 MB)**:
   - Should complete in < 30 seconds
   - Chart should render quickly

2. **Medium (100 MB - 1 GB)**:
   - Should complete in < 5 minutes
   - Memory usage should be reasonable

3. **Large (> 1 GB)**:
   - May take 10+ minutes
   - Monitor memory usage
   - Consider optimizing if needed

### Memory Usage

Monitor memory during analysis:

```bash
# On Mac/Linux
top -pid $(pgrep hprof-server)

# Or use Activity Monitor / Task Manager
```

Expected: Memory usage should be roughly equal to HPROF file size (due to memory mapping).

## Automated Testing (Future)

Consider adding:

1. **Unit tests** for Rust library:
   ```bash
   cd hprof-analyzer
   cargo test
   ```

2. **Integration tests** for RPC methods

3. **E2E tests** for VS Code extension using `@vscode/test-electron`

## Quick Test Checklist

- [ ] Rust server builds successfully
- [ ] TypeScript compiles without errors
- [ ] Extension loads in Development Host
- [ ] Command "Analyze HPROF File" appears in Command Palette
- [ ] File picker opens
- [ ] Progress bar shows during analysis
- [ ] Output channel shows progress
- [ ] Webview opens after analysis
- [ ] Sunburst chart displays
- [ ] Tooltips work on hover
- [ ] Clicking slices triggers drill-down
- [ ] Children load correctly
- [ ] Error messages are clear

## Getting Help

If you encounter issues:

1. Check the Output channel: "Heap Analyzer"
2. Check browser console in webview
3. Check Rust server stderr/stdout
4. Review logs with `RUST_LOG=debug`
5. Check VS Code Developer Tools console

## Next Steps

After successful testing:

1. Package the extension: `vsce package`
2. Install locally: `code --install-extension heap-analyzer-0.0.1.vsix`
3. Share with team for testing
4. Publish to VS Code Marketplace (when ready)
