# Quick Guide: Open Webview Developer Tools

## The Problem
You opened Developer Tools with `Cmd+Option+I`, but that's for the **Extension Host**, not the **webview**. The webview has its own separate Developer Tools.

## Solution: Right-Click Method (Easiest)

1. **Look at the Extension Development Host window**
   - Find the **"Heap Analysis"** tab (the black/empty panel)

2. **Right-click directly on the black/empty area** of the webview panel
   - NOT on the tab title
   - NOT on the toolbar
   - Click on the **actual content area** (even if it's black)

3. **Look for a context menu** that appears
   - It should have options like:
     - "Open Developer Tools" ← **Click this one**
     - "Inspect Element"
     - "Reload"

4. **A NEW Developer Tools window will open** - this is the webview's console!

## Visual Guide

```
┌─────────────────────────────────────┐
│ Extension Development Host          │
│                                     │
│  [Heap Analysis] ← Tab (don't     │
│  ┌───────────────────────────────┐ │
│  │                               │ │
│  │  [BLACK AREA]                 │ │ ← Right-click HERE
│  │                               │ │
│  │                               │ │
│  └───────────────────────────────┘ │
└─────────────────────────────────────┘
```

## Alternative: Command Palette

If right-click doesn't work:

1. Press `Cmd+Shift+P` (Mac) or `Ctrl+Shift+P` (Windows)
2. Type: `webview`
3. Select: **"Developer: Open Webview Developer Tools"**
4. If it asks which webview, select **"Heap Analysis"**

## How to Know You Have the Right One

The **webview Developer Tools** will show:
- Console messages starting with `[Webview]`
- Network requests for `d3.v7.min.js`
- HTML elements like `<div id="sunburst">` and `<div id="debug">`

The **Extension Host Developer Tools** (what you opened with Cmd+Option+I) shows:
- Messages like `[Extension Host]`
- Different console output

## Still Can't Find It?

1. Make sure the webview panel is **visible and active**
2. Try clicking once on the black area to focus it, then right-click
3. Try running the analysis command again to refresh the webview
4. Check if there's a small gear icon or menu icon in the webview panel

## What to Do Next

Once you have the **webview Developer Tools** open:
1. Go to the **Console** tab
2. Look for messages starting with `[Webview]`
3. Share what you see (or take a screenshot)
