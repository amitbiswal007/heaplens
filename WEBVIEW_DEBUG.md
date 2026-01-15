# Debugging the Webview

If the webview shows a black screen, follow these steps to debug:

## Step 1: Open Webview Developer Tools

1. **In the Extension Development Host window** (where the webview is displayed):
   - Right-click on the webview panel
   - Select **"Open Developer Tools"** from the context menu
   
   OR
   
   - Use Command Palette (`Cmd+Shift+P` / `Ctrl+Shift+P`)
   - Type "Developer: Open Webview Developer Tools"
   - Select the webview from the list

## Step 2: Check the Console Tab

In the Developer Tools window that opens:

1. Go to the **Console** tab
2. Look for messages starting with `[Webview]`
3. Check for any red error messages

## Expected Console Messages

You should see messages like:
```
[Webview] Script starting to execute...
[Webview] acquireVsCodeApi found
[Webview] VS Code API acquired
[Webview] Checking for D3.js...
[Webview] D3.js loaded successfully, version: 7.x.x
[Webview] Chart initialized successfully
[Webview] Received message: updateData 50
[Webview] Updating chart with 50 items
[Webview] Chart updated successfully
```

## Common Issues

### 1. No Console Messages at All
- **Problem**: The webview JavaScript isn't executing
- **Solution**: Check if the HTML is being set correctly. Look for errors in Extension Host logs.

### 2. "D3.js failed to load"
- **Problem**: No internet connection or CDN blocked
- **Solution**: Check your internet connection. The webview needs to load D3.js from `https://d3js.org/d3.v7.min.js`

### 3. "Chart not initialized"
- **Problem**: D3.js loaded but chart creation failed
- **Solution**: Check the console for the specific error message

### 4. "No data received for updateData"
- **Problem**: Data isn't being sent from the extension
- **Solution**: Check Extension Host logs for `[WebviewProvider] Sending X items to webview`

## Step 3: Check the Debug Panel

Look at the **top-right corner** of the webview. There should be a debug panel showing status messages like:
- "Webview loaded. Waiting for data..."
- "Received updateData: 50 items"
- "Chart updated successfully"

If you don't see this panel, the webview HTML might not be loading correctly.

## Step 4: Check Network Tab

In the Developer Tools:
1. Go to the **Network** tab
2. Reload the webview
3. Check if `d3.v7.min.js` is loading successfully (should show status 200)

## Reporting Issues

When reporting issues, please include:
1. All console messages from the webview Developer Tools
2. Screenshot of the debug panel (if visible)
3. Any error messages in red
4. Network tab showing D3.js loading status
