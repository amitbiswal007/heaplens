# Sunburst Chart Visualization

## Overview

The heap analysis extension uses a **Sunburst Chart** (radial space-filling visualization) to display the dominator tree structure, allowing users to instantly identify objects holding the most memory.

## Architecture

### Visualization Metaphor

- **Center**: GC Roots (SuperRoot node)
- **Rings**: Levels in the dominator tree
- **Arc Length**: Proportional to Retained Size
- **Color**: Different colors for different node types

### Data Transfer Strategy

Due to the large size of full heap graphs, we implement **Lazy Loading**:

1. **Initial Load**: Rust server sends only the top 2 layers of the dominator tree (up to 50 nodes)
2. **Drill Down**: When a user clicks a slice, the VS Code extension sends a `get_children` RPC request
3. **Update**: The Rust server queries the pre-calculated dominator tree and returns children
4. **Animation**: The chart animates the transition to show the new level

## Implementation

### Rust Server Side

#### Analysis State Storage

The server stores analysis state per file path:

```rust
struct FileAnalysisState {
    state: Arc<RwLock<Option<AnalysisState>>>,
    path: PathBuf,
}
```

The `AnalysisState` contains:
- `children_map`: Mapping from node index to children in dominator tree
- `retained_sizes`: Retained size for each node
- `shallow_sizes`: Shallow size for each node
- `id_to_node`: Mapping from object ID to node index
- `node_data_map`: Quick lookup for node information

#### Methods

1. **`calculate_dominators_with_state`**: Returns both top objects and analysis state
2. **`get_children`**: Queries children of a specific node by object ID
3. **`get_top_layers`**: Returns top N layers for initial visualization

#### RPC Methods

- **`analyze_heap`**: Performs full analysis and stores state
  - Returns: `top_objects` (top 50) and `top_layers` (top 2 layers)
  
- **`get_children`**: Returns children of a node
  - Parameters: `path` (file path), `object_id` (node to query)
  - Returns: Array of `ObjectReport` for children

### VS Code Extension Side

#### Webview Provider

The `HeapAnalysisWebviewProvider` class manages the webview:

- **`createOrShow`**: Creates or reveals the webview panel
- **`updateWithData`**: Sends initial data to webview
- Message handling for `getChildren` requests

#### Message Flow

```
Webview (click on slice)
    ↓
postMessage({ command: 'getChildren', objectId: 123 })
    ↓
Extension Host receives message
    ↓
rustClient.sendRequest('get_children', { path, object_id })
    ↓
Rust server queries stored analysis state
    ↓
Returns children array
    ↓
Extension sends childrenResponse to webview
    ↓
Webview updates chart with new data
```

### Webview Implementation

#### Technologies

- **D3.js v7**: For Sunburst chart rendering
- **React**: Not used in current implementation (can be added for component structure)
- **VS Code Webview API**: For communication with extension host

#### SunburstChart Class

Key methods:

- **`update(data, rootNode)`**: Updates chart with new data
- **`buildHierarchy(data, parentId)`**: Converts flat array to hierarchical structure
- **`drillDown(children, parentObjectId)`**: Handles drill-down to show children
- **`formatBytes(bytes)`**: Formats byte values for display

#### Features

1. **Interactive Tooltips**: Show node details on hover
   - Node type
   - Retained size
   - Shallow size
   - Object ID

2. **Click to Drill Down**: Click any slice to see its children

3. **Color Coding**: Different colors for different node types

4. **Responsive**: Adapts to container size

## Usage

### Initial Analysis

1. User triggers `javaheap.analyzeFile` command
2. Selects HPROF file
3. Analysis runs in background
4. When complete, webview opens with top 2 layers

### Drill Down

1. User clicks on a slice in the Sunburst chart
2. Extension sends `get_children` request to Rust server
3. Server returns children of that node
4. Chart updates to show children

### Data Structure

Each node in the visualization has:

```typescript
{
    name: string,           // Display name
    value: number,           // Retained size (for arc length)
    objectId: number,       // HPROF object ID
    nodeType: string,       // Type: Instance, Array, Class, etc.
    shallowSize: number,    // Shallow size in bytes
    retainedSize: number,   // Retained size in bytes
    children: []            // Children (populated on drill-down)
}
```

## Performance Considerations

### Memory Efficiency

- **Lazy Loading**: Only loads what's needed
- **State Storage**: Analysis state stored in memory for fast queries
- **Incremental Updates**: Chart updates incrementally, not full redraw

### Scalability

- **Top Layers**: Initial view limited to 50 nodes
- **Children Queries**: Each drill-down fetches only direct children
- **Caching**: Analysis state cached per file path

## Future Enhancements

1. **Breadcrumb Navigation**: Show path from root to current node
2. **Reset Button**: Return to root view
3. **Search**: Find nodes by object ID or type
4. **Filtering**: Filter by node type or size threshold
5. **Export**: Export visualization as image
6. **Animation**: Smooth transitions between views
7. **Zoom**: Zoom in/out on specific regions
8. **Multi-selection**: Compare multiple nodes

## Files

- `hprof-analyzer/src/lib.rs`: `AnalysisState` struct and methods
- `hprof-analyzer/src/main.rs`: Server state management and `get_children` handler
- `src/webviewProvider.ts`: Webview provider and HTML/JS implementation
- `src/extension.ts`: Integration with analysis completion

## Testing

1. Build Rust server:
   ```bash
   cd hprof-analyzer
   cargo build --release
   ```

2. Compile TypeScript:
   ```bash
   npm run compile
   ```

3. Launch Extension Development Host (F5)

4. Test flow:
   - Command Palette → "Analyze HPROF File"
   - Select HPROF file
   - Wait for analysis
   - Webview should open with Sunburst chart
   - Click on slices to drill down
   - Verify children are loaded
