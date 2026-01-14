# Testing the Heap Analyzer Extension

## Prerequisites Check

✅ **Rust binary**: `bin/analysis-engine` (628KB)
✅ **TypeScript compiled**: `out/extension.js` exists
✅ **Node dependencies**: Installed in `node_modules/`

## Step-by-Step Testing Guide

### 1. Open the Extension in VS Code

1. Open VS Code
2. Open the folder: `/Users/sachingupta/Documents/Learning/Cursor/sachinkg12/HeapScope/HeapScope`
3. This is your extension workspace

### 2. Launch Extension Development Host

**Option A: Using Command Palette**
- Press `Cmd+Shift+P` (macOS) or `Ctrl+Shift+P` (Windows/Linux)
- Type: `Debug: Start Debugging`
- Select it, or press `F5`

**Option B: Using the Debug Panel**
- Click the "Run and Debug" icon in the sidebar (or press `Cmd+Shift+D`)
- Select "Run Extension" from the dropdown
- Click the green play button or press `F5`

This will:
- Compile TypeScript (if needed)
- Launch a new VS Code window titled "[Extension Development Host]"
- Load your extension in that window

### 3. Test the Extension

In the **Extension Development Host** window:

1. **Open Command Palette**: `Cmd+Shift+P` (or `Ctrl+Shift+P`)
2. **Run Command**: Type `Parse HPROF File` and select it
3. **Select HPROF File**: A file picker will open
   - Navigate to a `.hprof` file
   - Select it and click "Open"

### 4. View Results

After selecting an HPROF file:
- The extension will spawn the Rust binary
- Parse the HPROF file
- Display results in the **"Heap Analyzer"** output channel

**To view the output:**
- Go to `View` → `Output` (or `Cmd+Shift+U`)
- Select "Heap Analyzer" from the dropdown
- You should see:
  - Analysis progress messages
  - JSON array of histogram entries with:
    - `class_name`: Java class name
    - `count`: Number of instances
    - `shallow_size`: Shallow heap size (currently 0, as size calculation needs class definitions)

### 5. Debugging

**View Debug Console:**
- In the original VS Code window (not Extension Development Host)
- Check the "Debug Console" tab
- Look for any error messages

**Check Extension Host Logs:**
- In Extension Development Host: `Help` → `Toggle Developer Tools`
- Check the Console tab for errors

**Test Rust Binary Directly:**
```bash
cd /Users/sachingupta/Documents/Learning/Cursor/sachinkg12/HeapScope/HeapScope
echo '{"jsonrpc":"2.0","id":1,"method":"parse_hprof","params":{"path":"/path/to/your/file.hprof"}}' | ./bin/analysis-engine
```

## Getting a Test HPROF File

If you don't have an HPROF file, you can generate one:

**From a Java Application:**
```bash
# Add JVM flags to generate heap dump on OutOfMemoryError
java -XX:+HeapDumpOnOutOfMemoryError -XX:HeapDumpPath=/tmp/heap.hprof YourApp

# Or trigger manually with jmap (requires JDK)
jmap -dump:format=b,file=heap.hprof <pid>
```

**Download Sample:**
- Search for "sample hprof file" online
- Many open-source projects include HPROF files in their test suites

## Troubleshooting

### "Rust binary not found"
- Verify: `ls -lh bin/analysis-engine`
- Check the path in `src/extension.ts` (should be `./bin/analysis-engine`)

### "Failed to spawn Rust process"
- Check file permissions: `chmod +x bin/analysis-engine`
- Verify binary works: `./bin/analysis-engine` (should wait for stdin)

### "HPROF parsing error"
- Verify the HPROF file is valid
- Check the Output channel for detailed error messages
- Test the binary directly (see above)

### Extension doesn't appear
- Check `package.json` has correct `main` path: `./out/extension.js`
- Recompile: `npm run compile`
- Reload Extension Development Host window

### No output in Output channel
- Make sure you selected "Heap Analyzer" from the dropdown
- Check if the command executed (look for "Analyzing HPROF file" message)

## Quick Test Checklist

- [ ] Extension Development Host launched successfully
- [ ] Command "Parse HPROF File" appears in Command Palette
- [ ] File picker opens when command is executed
- [ ] HPROF file can be selected
- [ ] "Heap Analyzer" output channel shows results
- [ ] JSON output contains histogram entries with class names and counts

## Next Steps

Once basic testing works:
1. Test with different HPROF file sizes
2. Verify performance with large files
3. Check error handling with invalid files
4. Enhance size calculation (currently returns 0)
