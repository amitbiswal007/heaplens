---
sidebar_position: 2
title: Debugging the Webview
---

# Debugging the Webview

The HeapLens webview runs in an isolated iframe within VS Code. It has its own JavaScript context and its own Developer Tools, separate from the Extension Host.

## Opening Webview Developer Tools

### Method 1: Right-Click (Recommended)

1. In the Extension Development Host window, open a `.hprof` file
2. Wait for the HeapLens webview to appear
3. **Right-click** anywhere on the webview content (not the tab bar)
4. Select **"Inspect Element"** or **"Open Developer Tools"**

### Method 2: Command Palette

1. Press `Cmd+Shift+P` (macOS) or `Ctrl+Shift+P`
2. Type `Developer: Open Webview Developer Tools`
3. Select the HeapLens webview if prompted

### Important Distinction

| Developer Tools | What It Shows | How to Open |
|----------------|---------------|-------------|
| Extension Host Console | TypeScript extension logs, RPC messages | `Cmd+Shift+P` → "Developer: Toggle Developer Tools" |
| **Webview Console** | HTML/CSS/JS of the tab UI, D3.js charts | Right-click on webview → Inspect |

The Extension Host console shows `console.log` from `extension.ts`, `hprofEditorProvider.ts`, etc. The Webview console shows `console.log` from the inline JavaScript in `webviewProvider.ts`.

## What to Look For

### Console Tab

Successful initialization looks like:

```
[Webview] Script loaded
[Webview] VS Code API acquired
[Webview] Waiting for analysis data...
[Webview] Received analysisComplete: 50 top objects, 8421 histogram entries
[Webview] Rendering overview...
[Webview] D3.js pie chart rendered
[Webview] All tabs ready
```

Common errors:

```
// D3.js failed to load (CSP or network issue)
Refused to load script from 'https://d3js.org/d3.v7.min.js'

// Data not received
[Webview] Error: Cannot read property 'summary' of undefined

// Chart rendering failure
[Webview] D3 error: invalid arc path
```

### Network Tab

Check that D3.js loads successfully:
- URL: `https://d3js.org/d3.v7.min.js`
- Status should be **200**
- If blocked, check the Content Security Policy in the HTML source

### Elements Tab

Useful for:
- Verifying tab content is rendered (look for `<div id="overview-content">`, `<div id="histogram-content">`, etc.)
- Checking if tables have rows
- Debugging CSS layout issues

## Common Webview Issues

### Blank webview (no content at all)

1. Check Console for JavaScript errors
2. Verify the `nonce` attribute matches between the CSP meta tag and the script tags
3. Check that `npm run compile` was run after changes to `webviewProvider.ts`

### Tabs switch but content is empty

The data may not have been received. Check:
1. Console for `[Webview] Received analysisComplete` message
2. Extension Host console for RPC errors
3. Whether the analysis actually completed (check Output channel)

### D3.js charts don't render

1. Check Network tab for D3 loading status
2. Check Console for D3-specific errors
3. Verify the SVG container elements exist in the DOM

### Table sorting doesn't work

1. Check Console for click handler errors
2. Verify the data array is populated (add `console.log(data)` temporarily)

## Adding Debug Logging

To add temporary debug logging to the webview, edit `webviewProvider.ts` and add `console.log` statements in the JavaScript section:

```javascript
// In the analysisComplete handler
case 'analysisComplete':
    console.log('[Webview] Raw data:', JSON.stringify(msg.data).substring(0, 500));
    console.log('[Webview] Histogram entries:', msg.data.classHistogram?.length);
    console.log('[Webview] Leak suspects:', msg.data.leakSuspects?.length);
    break;
```

Rebuild with `npm run compile`, restart the Extension Development Host (F5), and check the webview console.

## Debugging the Extension Host

For issues in the TypeScript layer (not the webview), use VS Code's built-in debugger:

1. Set breakpoints in `src/hprofEditorProvider.ts` or `src/rustClient.ts`
2. Press **F5** to launch with debugging
3. Trigger the action (open `.hprof` file, click a tree node, etc.)
4. The debugger pauses at breakpoints in the first VS Code window

### Logging RPC Messages

To see all JSON-RPC messages between the extension and the Rust server, check the Output channel (**View → Output → HeapLens**). Progress messages and errors from `hprof-server`'s stderr are displayed there.
