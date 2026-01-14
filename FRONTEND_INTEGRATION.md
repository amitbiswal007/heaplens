# Frontend Integration - VS Code Extension

## Overview

The VS Code extension integrates with the async Rust `hprof-server` binary to provide heap analysis capabilities through a user-friendly interface.

## Architecture

### RustClient Class

The `RustClient` class (`src/rustClient.ts`) provides a clean interface to communicate with the Rust server:

- **Spawns the Rust binary** using `child_process.spawn`
- **Listens to stdout** and splits by newline to decode JSON messages
- **Handles both responses and notifications** from the JSON-RPC 2.0 protocol
- **Implements `sendRequest()`** that returns a Promise resolving when the corresponding ID is received
- **Notification support** via `onNotification()` and `offNotification()` methods

### Command Registration

The extension registers the `javaheap.analyzeFile` command that:

1. **Opens a file picker** to select an HPROF file
2. **Spawns/connects to the Rust server** if not already running
3. **Sends the analyze_heap request** with the file path
4. **Shows a progress bar** during analysis
5. **Displays results** in the Output Channel when complete

## Implementation Details

### RustClient Features

```typescript
class RustClient {
    // Spawns Rust binary and sets up communication
    constructor(binaryPath: string)
    
    // Sends JSON-RPC request, returns Promise
    async sendRequest(method: string, params?: any): Promise<any>
    
    // Register handler for notifications
    onNotification(method: string, handler: (params: any) => void): void
    
    // Remove notification handler
    offNotification(method: string): void
    
    // Clean up and terminate process
    dispose(): void
}
```

### Message Handling

The client handles two types of messages:

1. **JSON-RPC Responses** (have `id` field):
   - Matches response ID to pending request
   - Resolves or rejects the corresponding Promise

2. **JSON-RPC Notifications** (no `id` field):
   - Dispatches to registered handlers
   - Used for `heap_analysis_complete` notifications

### Progress Bar Integration

The extension uses VS Code's `withProgress` API:

```typescript
await vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification,
    title: 'Analyzing HPROF File',
    cancellable: false
}, async (progress) => {
    progress.report({ increment: 20, message: 'Request sent...' });
    // ... wait for completion
    progress.report({ increment: 100, message: 'Complete!' });
});
```

### Binary Path Resolution

The extension looks for the `hprof-server` binary in:

1. **Production path**: `bin/hprof-server` (or `.exe` on Windows)
2. **Development path**: `hprof-analyzer/target/release/hprof-server`

This allows the extension to work both in development and after packaging.

## Usage

### From Command Palette

1. Press `Cmd+Shift+P` (or `Ctrl+Shift+P`)
2. Type "Analyze HPROF File"
3. Select the command
4. Choose an HPROF file from the file picker
5. Watch the progress bar
6. View results in the "Heap Analyzer" output channel

### Command Flow

```
User triggers command
    ↓
File picker opens
    ↓
User selects .hprof file
    ↓
RustClient spawns hprof-server (if needed)
    ↓
Send analyze_heap request
    ↓
Receive immediate "processing" response
    ↓
Show progress bar
    ↓
Wait for heap_analysis_complete notification
    ↓
Display results in Output Channel
    ↓
Show completion message
```

## Error Handling

- **Binary not found**: Shows error message with path
- **Server spawn failure**: Displays error and logs to output channel
- **Request timeout**: 5-minute timeout with error message
- **Analysis errors**: Displays error from server notification
- **Process crashes**: Handles process exit and cleans up

## Output Format

Results are displayed in the "Heap Analyzer" output channel:

```
Analyzing HPROF file: /path/to/heap.hprof

Connected to Rust analysis server
Sending analyze_heap request...
Request accepted, processing (request_id: 1)...
Analysis completed successfully!
Found 50 top objects by retained size

Top Objects:
[
  {
    "object_id": 123456,
    "node_type": "Instance",
    "shallow_size": 1024,
    "retained_size": 1048576
  },
  ...
]
```

## Files

- `src/rustClient.ts` - RustClient class implementation
- `src/extension.ts` - Command registration and integration
- `package.json` - Command registration in contributes section

## Testing

1. Build the Rust server:
   ```bash
   cd hprof-analyzer
   cargo build --release
   ```

2. Compile TypeScript:
   ```bash
   npm run compile
   ```

3. Launch Extension Development Host (F5 in VS Code)

4. Test the command:
   - Command Palette → "Analyze HPROF File"
   - Select an HPROF file
   - Verify progress bar appears
   - Check output channel for results

## Future Enhancements

- Cancel analysis mid-process
- Show intermediate progress updates
- Display results in a tree view
- Export results to file
- Filter and search results
- Visualize heap graph
