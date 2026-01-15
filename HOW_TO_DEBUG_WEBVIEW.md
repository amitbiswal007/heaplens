# How to Open Webview Developer Tools - Step by Step

## ⚠️ Important: Webview vs Extension Host Developer Tools

**The Developer Tools you opened with `Cmd+Option+I` is for the Extension Host, NOT the webview!**

The webview has its **own separate** Developer Tools window. You need to open it specifically.

## Method 1: Right-Click on Webview (Easiest - RECOMMENDED)

1. **In the Extension Development Host window** (the window that opened when you pressed F5):
   - Look for the **"Heap Analysis"** tab/panel (this is the webview)
   - **Right-click** anywhere on the black/empty webview panel
   - A context menu should appear
   - Select **"Open Developer Tools"** or **"Inspect Element"**

2. A new Developer Tools window will open - this is the **webview's console**

3. In the Developer Tools window:
   - Click on the **"Console"** tab
   - You should see messages starting with `[Webview]`

## Method 2: Command Palette

1. **In the Extension Development Host window**:
   - Press `Cmd+Shift+P` (Mac) or `Ctrl+Shift+P` (Windows/Linux)
   - Type: `Developer: Open Webview Developer Tools`
   - Select it from the dropdown

2. A dialog may appear asking you to select which webview - select **"Heap Analysis"**

3. The Developer Tools window will open

## Method 3: Keyboard Shortcut (if available)

Some VS Code versions support:
- `Cmd+Option+I` (Mac) or `Ctrl+Shift+I` (Windows/Linux) while the webview is focused

## What You Should See

Once the Developer Tools are open:

### In the Console Tab:
You should see messages like:
```
[Webview] Script starting to execute...
[Webview] acquireVsCodeApi found
[Webview] VS Code API acquired
[Webview] Checking for D3.js...
[Webview] D3.js loaded successfully, version: 7.x.x
[Webview] Chart initialized successfully
[Webview] Received message: updateData 50
```

### In the Network Tab:
- Check if `d3.v7.min.js` loaded successfully (status should be 200)
- If it shows "Failed" or "Blocked", D3.js isn't loading

### In the Elements Tab:
- You should see the HTML structure
- Look for `<div id="sunburst">` and `<div id="debug">`

## Troubleshooting

### If Right-Click Doesn't Work:
- Try clicking once on the webview to focus it, then right-click
- Make sure you're clicking on the webview panel itself, not the tab

### If Command Palette Method Doesn't Work:
- Make sure you're in the **Extension Development Host** window (not the main VS Code window)
- Try typing just `webview` in the command palette to see related commands

### If No Developer Tools Option Appears:
- The webview might not be fully loaded
- Try closing and reopening the webview (run the command again)
- Check if there are any errors in the Extension Host console

### If Developer Tools Open But Console is Empty:
- The webview JavaScript might not be executing
- Check the **Network** tab to see if scripts are loading
- Check for any **red error messages** in the Console tab

## Visual Guide

```
┌─────────────────────────────────────────┐
│ Extension Development Host Window       │
│                                         │
│  ┌─────────────────────────────────┐  │
│  │  Heap Analysis (webview tab)    │  │
│  ├─────────────────────────────────┤  │
│  │                                 │  │
│  │  [Black/Empty Area]             │  │ ← Right-click HERE
│  │                                 │  │
│  │                                 │  │
│  └─────────────────────────────────┘  │
└─────────────────────────────────────────┘
         ↓ (Right-click)
┌─────────────────────────────────────────┐
│ Context Menu:                           │
│  • Open Developer Tools  ← Click this │
│  • Inspect Element                      │
│  • Reload                                │
└─────────────────────────────────────────┘
         ↓
┌─────────────────────────────────────────┐
│ Developer Tools Window                  │
│ ┌─────┬─────┬─────┬─────┐              │
│ │Console│Network│Elements│Sources│      │
│ └─────┴─────┴─────┴─────┴─────┘        │
│                                         │
│ [Webview] Script starting...          │
│ [Webview] D3.js loaded...              │
│ ...                                     │
└─────────────────────────────────────────┘
```

## Next Steps After Opening

Once you have the Developer Tools open:

1. **Check the Console tab** for `[Webview]` messages
2. **Check the Network tab** to see if D3.js loaded
3. **Look for any red error messages**
4. **Share what you see** - this will help diagnose the issue!

## Still Having Issues?

If you can't open the Developer Tools:
1. Check the **Extension Host console** (the one you've been looking at)
2. Look for any errors about the webview
3. Try restarting the Extension Development Host (stop and press F5 again)
4. Make sure the webview panel is actually visible and not hidden
