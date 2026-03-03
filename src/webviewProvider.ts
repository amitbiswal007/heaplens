import * as vscode from 'vscode';

/**
 * Returns the HTML content for the HeapLens tabbed webview.
 *
 * Seven tabs:
 * 1. Overview — summary stats + top 10 objects table + pie chart
 * 2. Histogram — sortable class histogram table with search
 * 3. Dominator Tree — expandable tree with lazy drill-down + optional sunburst
 * 4. Leak Suspects — card layout with severity indicators
 * 5. Waste — duplicate strings and empty collections analysis
 * 6. Source — browsable resolvable classes with source resolution status
 * 7. AI Chat — LLM-powered heap analysis Q&A
 */
export function getWebviewContent(_webview: vscode.Webview): string {
    const d3Uri = 'https://d3js.org/d3.v7.min.js';

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' https://d3js.org; style-src 'unsafe-inline';">
    <title>HeapLens</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, sans-serif);
            color: var(--vscode-foreground);
            background: var(--vscode-editor-background);
            overflow-x: hidden;
        }

        /* Tab bar */
        .tab-bar {
            display: flex;
            border-bottom: 1px solid var(--vscode-panel-border);
            background: var(--vscode-editorGroupHeader-tabsBackground);
            position: sticky;
            top: 0;
            z-index: 100;
        }
        .tab-btn {
            padding: 10px 20px;
            border: none;
            background: transparent;
            color: var(--vscode-foreground);
            cursor: pointer;
            font-size: 13px;
            border-bottom: 2px solid transparent;
            opacity: 0.7;
        }
        .tab-btn:hover { opacity: 1; }
        .tab-btn.active {
            opacity: 1;
            border-bottom-color: var(--vscode-focusBorder);
            color: var(--vscode-foreground);
        }

        /* Tab content */
        .tab-content { display: none; padding: 16px; }
        .tab-content.active { display: block; }

        /* Stats bar */
        .stats-bar {
            display: flex;
            gap: 16px;
            flex-wrap: wrap;
            margin-bottom: 20px;
        }
        .stat-card {
            padding: 12px 20px;
            background: var(--vscode-editorWidget-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 4px;
            min-width: 140px;
        }
        .stat-card .label {
            font-size: 11px;
            text-transform: uppercase;
            opacity: 0.7;
            margin-bottom: 4px;
        }
        .stat-card .value {
            font-size: 20px;
            font-weight: bold;
        }

        /* Tables */
        table {
            width: 100%;
            border-collapse: collapse;
            font-size: 13px;
        }
        th, td {
            padding: 8px 12px;
            text-align: left;
            border-bottom: 1px solid var(--vscode-panel-border);
        }
        th {
            background: var(--vscode-editorWidget-background);
            cursor: pointer;
            user-select: none;
            position: sticky;
            top: 42px;
            z-index: 10;
        }
        th:hover { background: var(--vscode-list-hoverBackground); }
        th .sort-arrow { margin-left: 4px; opacity: 0.5; }
        tr:hover { background: var(--vscode-list-hoverBackground); }
        .right { text-align: right; }

        /* Search */
        .search-box {
            padding: 6px 12px;
            margin-bottom: 12px;
            width: 100%;
            max-width: 400px;
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 4px;
            font-size: 13px;
        }
        .search-box:focus {
            outline: none;
            border-color: var(--vscode-focusBorder);
        }

        /* Dominator tree */
        .tree-row {
            display: flex;
            align-items: center;
            padding: 6px 12px;
            border-bottom: 1px solid var(--vscode-panel-border);
        }
        .tree-row.expandable { cursor: pointer; }
        .tree-row:hover { background: var(--vscode-list-hoverBackground); }
        .tree-toggle { width: 20px; text-align: center; opacity: 0.6; flex-shrink: 0; font-size: 11px; }
        .tree-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .tree-type {
            font-size: 10px;
            padding: 1px 5px;
            border-radius: 3px;
            margin-left: 8px;
            flex-shrink: 0;
            opacity: 0.7;
        }
        .tree-type.array { background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
        .tree-type.instance { background: var(--vscode-editorWidget-background); border: 1px solid var(--vscode-panel-border); }
        .tree-shallow { min-width: 80px; text-align: right; opacity: 0.5; font-size: 12px; }
        .tree-size { min-width: 90px; text-align: right; opacity: 0.8; }
        .tree-bar-wrap { width: 60px; flex-shrink: 0; margin: 0 8px; }
        .tree-bar { height: 4px; border-radius: 2px; background: var(--vscode-progressBar-background); min-width: 1px; }
        .tree-pct { min-width: 50px; text-align: right; opacity: 0.6; font-size: 12px; }
        .tree-children { padding-left: 20px; }
        .tree-source {
            margin-left: 6px;
            flex-shrink: 0;
            cursor: pointer;
            opacity: 0;
            font-size: 12px;
            transition: opacity 0.15s;
        }
        .tree-row:hover .tree-source { opacity: 0.6; }
        .tree-source:hover { opacity: 1 !important; }
        .dep-badge {
            display: inline-block;
            font-size: 10px;
            padding: 1px 6px;
            border-radius: 3px;
            background: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
            opacity: 0.8;
            margin-left: 6px;
            white-space: nowrap;
        }
        .dep-badge.workspace { background: var(--vscode-testing-iconPassed, #388a34); }
        .dep-badge.decompiled { opacity: 0.6; font-style: italic; }

        /* Leak suspect cards */
        .suspect-card {
            padding: 16px;
            margin-bottom: 12px;
            background: var(--vscode-editorWidget-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 6px;
            border-left: 4px solid var(--vscode-editorWarning-foreground);
        }
        .suspect-card.high { border-left-color: var(--vscode-editorError-foreground); }
        .suspect-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 8px;
        }
        .suspect-class { font-weight: bold; font-size: 14px; }
        .suspect-badge {
            padding: 2px 8px;
            border-radius: 10px;
            font-size: 11px;
            font-weight: bold;
        }
        .suspect-badge.high {
            background: var(--vscode-editorError-foreground);
            color: var(--vscode-editor-background);
        }
        .suspect-badge.medium {
            background: var(--vscode-editorWarning-foreground);
            color: var(--vscode-editor-background);
        }
        .suspect-desc { opacity: 0.8; font-size: 13px; }
        .go-to-source-link {
            cursor: pointer;
            color: var(--vscode-textLink-foreground);
            text-decoration: none;
            margin-left: 8px;
        }
        .go-to-source-link:hover { text-decoration: underline; }

        /* Charts */
        #pie-chart { width: 100%; max-width: 500px; margin: 20px auto; }
        #sunburst-chart { width: 100%; display: flex; justify-content: center; margin-top: 16px; }

        /* AI Chat tab */
        .chat-container {
            display: flex;
            flex-direction: column;
            height: calc(100vh - 60px);
        }
        .chat-messages {
            flex: 1;
            overflow-y: auto;
            padding: 16px;
        }
        .chat-bubble {
            max-width: 80%;
            padding: 10px 14px;
            margin-bottom: 10px;
            border-radius: 8px;
            font-size: 13px;
            line-height: 1.5;
            white-space: pre-wrap;
            word-wrap: break-word;
        }
        .chat-bubble.user {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            margin-left: auto;
            border-bottom-right-radius: 2px;
        }
        .chat-bubble.assistant {
            background: var(--vscode-editorWidget-background);
            border: 1px solid var(--vscode-panel-border);
            margin-right: auto;
            border-bottom-left-radius: 2px;
        }
        .chat-bubble.error {
            background: var(--vscode-inputValidation-errorBackground, #5a1d1d);
            border: 1px solid var(--vscode-editorError-foreground);
            margin-right: auto;
            border-bottom-left-radius: 2px;
        }
        .chat-input-row {
            display: flex;
            gap: 8px;
            padding: 12px 16px;
            border-top: 1px solid var(--vscode-panel-border);
            background: var(--vscode-editorWidget-background);
        }
        .chat-input {
            flex: 1;
            padding: 8px 12px;
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 4px;
            font-size: 13px;
            font-family: inherit;
            resize: none;
            min-height: 36px;
            max-height: 120px;
        }
        .chat-input:focus {
            outline: none;
            border-color: var(--vscode-focusBorder);
        }
        .chat-send {
            padding: 8px 16px;
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 13px;
            align-self: flex-end;
        }
        .chat-send:hover { background: var(--vscode-button-hoverBackground); }
        .chat-send:disabled { opacity: 0.5; cursor: not-allowed; }
        .chat-placeholder {
            text-align: center;
            opacity: 0.5;
            padding: 40px;
            font-size: 13px;
        }

        /* Query tab */
        .query-container { max-width: 100%; }
        .query-input-row { display: flex; gap: 8px; margin-bottom: 8px; }
        .query-input {
            flex: 1;
            font-family: var(--vscode-editor-font-family, monospace);
            font-size: 13px;
            padding: 8px 12px;
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 4px;
            resize: vertical;
        }
        .query-input:focus { outline: none; border-color: var(--vscode-focusBorder); }
        .query-actions { display: flex; flex-direction: column; gap: 4px; }
        .query-run-btn { min-width: 60px; }
        .query-help-btn { min-width: 60px; font-size: 16px; font-weight: bold; }
        .query-status {
            font-size: 12px;
            opacity: 0.7;
            margin-bottom: 8px;
            min-height: 18px;
        }
        .query-status.error { color: var(--vscode-editorError-foreground); opacity: 1; }
        .query-history {
            display: flex;
            gap: 4px;
            flex-wrap: wrap;
            margin-bottom: 8px;
        }
        .query-history-item {
            padding: 2px 8px;
            font-size: 11px;
            background: var(--vscode-editorWidget-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 3px;
            cursor: pointer;
            max-width: 300px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        .query-history-item:hover { background: var(--vscode-list-hoverBackground); }
        .query-help {
            padding: 12px;
            margin-bottom: 12px;
            background: var(--vscode-editorWidget-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 4px;
            font-size: 12px;
            line-height: 1.6;
        }
        .query-help-title { font-weight: bold; font-size: 13px; margin-bottom: 8px; }
        .query-help-section { margin-bottom: 6px; }
        .query-help code {
            background: var(--vscode-textCodeBlock-background);
            padding: 1px 4px;
            border-radius: 3px;
            font-size: 12px;
        }
        .query-results { overflow-x: auto; }
        .query-results table { font-size: 12px; }
        .query-results th { font-size: 11px; cursor: default; }

        .loading {
            padding: 40px;
            text-align: center;
            opacity: 0.6;
            font-size: 14px;
        }

        .section-title {
            font-size: 16px;
            font-weight: bold;
            margin: 20px 0 12px 0;
        }

        .btn {
            padding: 6px 14px;
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 12px;
            margin-right: 8px;
        }
        .btn:hover { background: var(--vscode-button-hoverBackground); }

        /* Source-not-found toast */
        .source-toast {
            position: fixed;
            bottom: 20px;
            left: 50%;
            transform: translateX(-50%);
            padding: 10px 20px;
            background: var(--vscode-editorWidget-background);
            border: 1px solid var(--vscode-editorWarning-foreground, #cca700);
            border-radius: 6px;
            font-size: 12px;
            opacity: 0;
            transition: opacity 0.3s;
            z-index: 200;
            pointer-events: none;
            max-width: 80%;
            text-align: center;
            box-shadow: 0 2px 8px rgba(0,0,0,0.3);
        }
        .source-toast.visible { opacity: 1; }

        /* GC Root Path Breadcrumb */
        .gc-path-breadcrumb {
            display: flex;
            align-items: center;
            gap: 4px;
            padding: 10px 16px;
            margin-bottom: 12px;
            background: var(--vscode-editorWidget-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 6px;
            overflow-x: auto;
            white-space: nowrap;
            position: relative;
        }
        .gc-path-label {
            font-size: 11px;
            font-weight: bold;
            text-transform: uppercase;
            opacity: 0.6;
            margin-right: 8px;
            flex-shrink: 0;
        }
        .gc-path-node {
            display: inline-block;
            padding: 3px 10px;
            border-radius: 12px;
            font-size: 12px;
            background: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
            flex-shrink: 0;
        }
        .gc-path-node.root {
            background: var(--vscode-testing-iconPassed, #388a34);
            color: #fff;
        }
        .gc-path-node.target {
            background: var(--vscode-editorError-foreground);
            color: #fff;
        }
        .gc-path-arrow {
            opacity: 0.4;
            font-size: 11px;
            flex-shrink: 0;
        }
        .gc-path-close {
            position: absolute;
            right: 8px;
            top: 50%;
            transform: translateY(-50%);
            cursor: pointer;
            opacity: 0.5;
            font-size: 14px;
            padding: 2px 6px;
            border: none;
            background: none;
            color: var(--vscode-foreground);
        }
        .gc-path-close:hover { opacity: 1; }
        .tree-pin {
            margin-left: 6px;
            flex-shrink: 0;
            cursor: pointer;
            opacity: 0;
            font-size: 12px;
            transition: opacity 0.15s;
        }
        .tree-row:hover .tree-pin { opacity: 0.6; }
        .tree-pin:hover { opacity: 1 !important; }
        .tree-field-name {
            color: var(--vscode-textLink-foreground, #3794ff);
            margin-right: 4px;
            font-weight: 500;
        }
        .tree-inspect {
            margin-left: 6px;
            flex-shrink: 0;
            cursor: pointer;
            opacity: 0;
            font-size: 12px;
            transition: opacity 0.15s;
        }
        .tree-row:hover .tree-inspect { opacity: 0.6; }
        .tree-inspect:hover { opacity: 1 !important; }
        .gc-path-field {
            font-style: italic;
            opacity: 0.7;
            font-size: 11px;
            margin: 0 2px;
        }
        /* Inspector panel */
        .inspector-panel {
            position: fixed;
            top: 0;
            right: 0;
            width: 380px;
            height: 100%;
            background: var(--vscode-editor-background);
            border-left: 2px solid var(--vscode-panel-border);
            overflow-y: auto;
            z-index: 1000;
            display: none;
            box-shadow: -2px 0 8px rgba(0,0,0,0.2);
        }
        .inspector-panel.visible { display: block; }
        .inspector-header {
            padding: 12px 16px;
            border-bottom: 1px solid var(--vscode-panel-border);
            display: flex;
            justify-content: space-between;
            align-items: center;
            position: sticky;
            top: 0;
            background: var(--vscode-editor-background);
            z-index: 1;
        }
        .inspector-header h3 { margin: 0; font-size: 13px; }
        .inspector-close {
            background: none;
            border: none;
            color: var(--vscode-foreground);
            font-size: 18px;
            cursor: pointer;
            opacity: 0.6;
            padding: 0 4px;
        }
        .inspector-close:hover { opacity: 1; }
        .inspector-body { padding: 8px 0; }
        .inspector-field {
            display: flex;
            align-items: baseline;
            padding: 5px 16px;
            border-bottom: 1px solid var(--vscode-panel-border);
            font-size: 12px;
            gap: 8px;
        }
        .inspector-field:hover { background: var(--vscode-list-hoverBackground); }
        .inspector-field-name { font-weight: 600; min-width: 100px; flex-shrink: 0; }
        .inspector-field-type { opacity: 0.5; min-width: 50px; flex-shrink: 0; }
        .inspector-field-value { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .inspector-ref-link {
            color: var(--vscode-textLink-foreground, #3794ff);
            cursor: pointer;
            text-decoration: none;
        }
        .inspector-ref-link:hover { text-decoration: underline; }
        .inspector-sizes { opacity: 0.5; font-size: 11px; flex-shrink: 0; }
        .inspector-loading { padding: 20px; text-align: center; opacity: 0.5; }

        /* Explain button & area (inspector) */
        .inspector-explain-btn {
            display: block;
            width: calc(100% - 32px);
            margin: 12px 16px;
            padding: 8px 12px;
            background: var(--vscode-editorWidget-background);
            color: var(--vscode-foreground);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 4px;
            cursor: pointer;
            font-size: 12px;
            text-align: center;
        }
        .inspector-explain-btn:hover { background: var(--vscode-list-hoverBackground); }
        .inspector-explain-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .inspector-explain-area {
            display: none;
            margin: 0 16px 12px;
            padding: 10px 12px;
            border: 1px solid var(--vscode-panel-border);
            border-radius: 4px;
            font-size: 12px;
            line-height: 1.6;
            white-space: pre-wrap;
            word-wrap: break-word;
            max-height: 400px;
            overflow-y: auto;
        }
        .inspector-explain-area.visible { display: block; }
        .inspector-explain-area.streaming {
            border-left: 3px solid var(--vscode-focusBorder);
        }
        .inspector-explain-area.error {
            border-color: var(--vscode-editorError-foreground);
            color: var(--vscode-editorError-foreground);
        }

        /* Explain link & area (leak suspect cards) */
        .suspect-explain-link {
            cursor: pointer;
            color: var(--vscode-textLink-foreground);
            text-decoration: none;
        }
        .suspect-explain-link:hover { text-decoration: underline; }
        .suspect-explain-area {
            display: none;
            margin-top: 10px;
            padding: 10px 12px;
            border: 1px solid var(--vscode-panel-border);
            border-radius: 4px;
            font-size: 12px;
            line-height: 1.6;
            white-space: pre-wrap;
            word-wrap: break-word;
            max-height: 400px;
            overflow-y: auto;
        }
        .suspect-explain-area.visible { display: block; }
        .suspect-explain-area.streaming {
            border-left: 3px solid var(--vscode-focusBorder);
        }
        .suspect-explain-area.error {
            border-color: var(--vscode-editorError-foreground);
            color: var(--vscode-editorError-foreground);
        }

        /* Auto-Diagnosis cards */
        .diagnosis-section { margin-bottom: 20px; }
        .diagnosis-card {
            padding: 12px 16px;
            margin-bottom: 8px;
            border-radius: 6px;
            font-size: 13px;
            border-left: 4px solid var(--vscode-panel-border);
            background: var(--vscode-editorWidget-background);
        }
        .diagnosis-card.critical {
            border-left-color: var(--vscode-editorError-foreground);
            background: color-mix(in srgb, var(--vscode-editorError-foreground) 8%, var(--vscode-editorWidget-background));
        }
        .diagnosis-card.warning {
            border-left-color: var(--vscode-editorWarning-foreground);
            background: color-mix(in srgb, var(--vscode-editorWarning-foreground) 8%, var(--vscode-editorWidget-background));
        }
        .diagnosis-card.info {
            border-left-color: var(--vscode-focusBorder);
        }
        .diagnosis-severity {
            font-size: 10px;
            font-weight: bold;
            text-transform: uppercase;
            margin-bottom: 4px;
        }
        .diagnosis-card.critical .diagnosis-severity { color: var(--vscode-editorError-foreground); }
        .diagnosis-card.warning .diagnosis-severity { color: var(--vscode-editorWarning-foreground); }
        .diagnosis-card.info .diagnosis-severity { color: var(--vscode-focusBorder); }
        .diagnosis-title { font-weight: bold; margin-bottom: 4px; }
        .diagnosis-detail { opacity: 0.8; font-size: 12px; }

        /* Report button */
        #report-actions {
            display: none;
            margin-bottom: 16px;
        }
        .report-copied {
            display: inline-block;
            margin-left: 8px;
            font-size: 12px;
            color: var(--vscode-testing-iconPassed, #388a34);
            opacity: 0;
            transition: opacity 0.3s;
        }
        .report-copied.visible { opacity: 1; }

        /* Source tab */
        .source-status {
            display: inline-block;
            width: 8px;
            height: 8px;
            border-radius: 50%;
            margin-right: 6px;
            vertical-align: middle;
        }
        .source-status.not-tried { background: var(--vscode-panel-border); }
        .source-status.resolving { background: var(--vscode-focusBorder); animation: pulse 1s infinite; }
        .source-status.found { background: var(--vscode-testing-iconPassed, #388a34); }
        .source-status.not-found { background: var(--vscode-editorError-foreground); opacity: 0.5; }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
        .source-view-btn {
            padding: 3px 10px;
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            border-radius: 3px;
            cursor: pointer;
            font-size: 11px;
        }
        .source-view-btn:hover { background: var(--vscode-button-hoverBackground); }
        .source-view-btn:disabled { opacity: 0.4; cursor: not-allowed; }
        .source-stats {
            font-size: 12px;
            opacity: 0.6;
            margin-bottom: 12px;
        }

        /* Waste tab */
        .waste-summary-bar {
            display: flex;
            gap: 16px;
            flex-wrap: wrap;
            margin-bottom: 20px;
        }
        .waste-stat-card {
            padding: 12px 20px;
            background: var(--vscode-editorWidget-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 4px;
            min-width: 160px;
        }
        .waste-stat-card .label {
            font-size: 11px;
            text-transform: uppercase;
            opacity: 0.7;
            margin-bottom: 4px;
        }
        .waste-stat-card .value {
            font-size: 20px;
            font-weight: bold;
        }
        .waste-stat-card .value.highlight {
            color: var(--vscode-editorWarning-foreground);
        }
        .waste-section-title {
            font-size: 14px;
            font-weight: bold;
            margin: 20px 0 10px 0;
            opacity: 0.9;
        }
        /* Compare tab */
        .compare-controls {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-bottom: 20px;
            flex-wrap: wrap;
        }
        .compare-select {
            padding: 6px 12px;
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 4px;
            font-size: 13px;
            min-width: 300px;
            max-width: 500px;
        }
        .compare-select:focus {
            outline: none;
            border-color: var(--vscode-focusBorder);
        }
        .compare-status {
            font-size: 12px;
            opacity: 0.7;
            margin-left: 8px;
        }
        .compare-status.error { color: var(--vscode-editorError-foreground); opacity: 1; }
        .delta-positive { color: var(--vscode-editorError-foreground, #f44); }
        .delta-negative { color: var(--vscode-testing-iconPassed, #388a34); }
        .delta-zero { opacity: 0.5; }
        .change-badge {
            display: inline-block;
            padding: 1px 6px;
            border-radius: 3px;
            font-size: 10px;
            font-weight: bold;
            text-transform: uppercase;
        }
        .change-badge.new { background: var(--vscode-editorError-foreground); color: #fff; }
        .change-badge.removed { background: var(--vscode-testing-iconPassed, #388a34); color: #fff; }
        .change-badge.grew { background: var(--vscode-editorWarning-foreground); color: var(--vscode-editor-background); }
        .change-badge.shrank { background: var(--vscode-focusBorder); color: #fff; }
        .change-badge.unchanged { background: var(--vscode-panel-border); opacity: 0.6; }
        .change-badge.resolved { background: var(--vscode-testing-iconPassed, #388a34); color: #fff; }
        .change-badge.persisted { background: var(--vscode-editorWarning-foreground); color: var(--vscode-editor-background); }
        .compare-section-title {
            font-size: 15px;
            font-weight: bold;
            margin: 24px 0 12px 0;
        }
        .compare-stat-card {
            padding: 12px 20px;
            background: var(--vscode-editorWidget-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 4px;
            min-width: 160px;
        }
        .compare-stat-card .label {
            font-size: 11px;
            text-transform: uppercase;
            opacity: 0.7;
            margin-bottom: 4px;
        }
        .compare-stat-card .value {
            font-size: 18px;
            font-weight: bold;
        }
        .compare-stat-card .delta {
            font-size: 12px;
            margin-top: 2px;
        }
        .compare-leak-card {
            padding: 14px 16px;
            margin-bottom: 10px;
            background: var(--vscode-editorWidget-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 6px;
            border-left: 4px solid var(--vscode-panel-border);
        }
        .compare-leak-card.new { border-left-color: var(--vscode-editorError-foreground); }
        .compare-leak-card.resolved { border-left-color: var(--vscode-testing-iconPassed, #388a34); }
        .compare-leak-card.persisted { border-left-color: var(--vscode-editorWarning-foreground); }

        .waste-preview {
            max-width: 400px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            font-family: var(--vscode-editor-font-family, monospace);
            font-size: 12px;
            opacity: 0.85;
        }
    </style>
</head>
<body>
    <div class="tab-bar">
        <button class="tab-btn active" data-tab="overview">Overview</button>
        <button class="tab-btn" data-tab="histogram">Histogram</button>
        <button class="tab-btn" data-tab="domtree">Dominator Tree</button>
        <button class="tab-btn" data-tab="leaks">Leak Suspects</button>
        <button class="tab-btn" data-tab="waste">Waste</button>
        <button class="tab-btn" data-tab="source">Source</button>
        <button class="tab-btn" data-tab="query">Query</button>
        <button class="tab-btn" data-tab="compare">Compare</button>
        <button class="tab-btn" data-tab="chat">AI Chat</button>
    </div>

    <!-- Tab 1: Overview -->
    <div id="tab-overview" class="tab-content active">
        <div class="stats-bar" id="stats-bar">
            <div class="loading">Waiting for analysis...</div>
        </div>
        <div id="report-actions">
            <button class="btn" id="copy-report-btn">Copy Incident Report</button>
            <span class="report-copied" id="report-copied">Copied!</span>
        </div>
        <div id="diagnosis-section" class="diagnosis-section"></div>
        <div class="section-title">Top Objects by Retained Size</div>
        <div id="top-objects-table"></div>
        <div class="section-title">Heap Composition</div>
        <div id="pie-chart"></div>
    </div>

    <!-- Tab 2: Histogram -->
    <div id="tab-histogram" class="tab-content">
        <input type="text" class="search-box" id="histogram-search" placeholder="Filter by class name...">
        <div id="histogram-table"></div>
    </div>

    <!-- Tab 3: Dominator Tree -->
    <div id="tab-domtree" class="tab-content">
        <button class="btn" id="reset-tree-btn" style="display:none; margin-bottom: 12px;">Back to Root</button>
        <div id="domtree-header" style="display:none;">
            <div class="tree-row" style="opacity:0.6; font-size:11px; border-bottom:2px solid var(--vscode-panel-border); cursor:default;">
                <span class="tree-toggle"></span>
                <span class="tree-name" style="font-weight:bold;">Class / Object</span>
                <span class="tree-type" style="background:none; border:none;">Type</span>
                <span class="tree-shallow" style="font-weight:bold;">Shallow</span>
                <span class="tree-size" style="font-weight:bold;">Retained</span>
                <span class="tree-bar-wrap"></span>
                <span class="tree-pct" style="font-weight:bold;">%</span>
            </div>
        </div>
        <div id="dominator-tree"><div class="loading">Waiting for analysis...</div></div>
        <div id="sunburst-chart"></div>
    </div>

    <!-- Tab 4: Leak Suspects -->
    <div id="tab-leaks" class="tab-content">
        <div id="leak-suspects"><div class="loading">Waiting for analysis...</div></div>
    </div>

    <!-- Tab 5: Waste -->
    <div id="tab-waste" class="tab-content">
        <div class="waste-summary-bar" id="waste-summary-bar">
            <div class="loading">Waiting for analysis...</div>
        </div>
        <div class="waste-section-title" id="waste-dup-title" style="display:none;">Duplicate Strings</div>
        <div id="waste-dup-table"></div>
        <div class="waste-section-title" id="waste-empty-title" style="display:none;">Empty Collections</div>
        <div id="waste-empty-table"></div>
    </div>

    <!-- Tab 6: Source -->
    <div id="tab-source" class="tab-content">
        <input type="text" class="search-box" id="source-search" placeholder="Filter by class name...">
        <div class="source-stats" id="source-stats"></div>
        <div id="source-table"><div class="loading">Waiting for analysis...</div></div>
    </div>

    <!-- Tab 7: Query -->
    <div id="tab-query" class="tab-content">
        <div class="query-container">
            <div class="query-input-row">
                <textarea class="query-input" id="query-input" placeholder="SELECT * FROM class_histogram ORDER BY retained_size DESC LIMIT 10" rows="3"></textarea>
                <div class="query-actions">
                    <button class="btn query-run-btn" id="query-run-btn">Run</button>
                    <button class="btn query-help-btn" id="query-help-btn" title="Show help">?</button>
                </div>
            </div>
            <div class="query-status" id="query-status"></div>
            <div class="query-history" id="query-history"></div>
            <div class="query-help" id="query-help" style="display:none;">
                <div class="query-help-title">HeapQL Reference</div>
                <div class="query-help-section">
                    <b>Tables:</b>
                    <code>instances</code> (object_id, node_type, class_name, shallow_size, retained_size),
                    <code>class_histogram</code> (class_name, instance_count, shallow_size, retained_size),
                    <code>dominator_tree</code> (same as instances; use WHERE object_id = X),
                    <code>leak_suspects</code> (class_name, object_id, retained_size, retained_percentage, description)
                </div>
                <div class="query-help-section">
                    <b>Syntax:</b> SELECT [columns|*] FROM table [WHERE conditions] [ORDER BY col [ASC|DESC]] [LIMIT n]
                </div>
                <div class="query-help-section">
                    <b>Operators:</b> =, !=, &gt;, &lt;, &gt;=, &lt;=, LIKE (% wildcards). Combine with AND / OR.
                </div>
                <div class="query-help-section">
                    <b>Special commands:</b>
                    <code>:path &lt;id&gt;</code> GC root path,
                    <code>:refs &lt;id&gt;</code> referrers,
                    <code>:children &lt;id&gt;</code> dominator children,
                    <code>:info &lt;id&gt;</code> object details
                </div>
                <div class="query-help-section">
                    <b>Examples:</b><br>
                    <code>SELECT * FROM class_histogram ORDER BY retained_size DESC LIMIT 10</code><br>
                    <code>SELECT * FROM instances WHERE class_name LIKE '%Cache%' AND retained_size &gt; 1024</code><br>
                    <code>SELECT class_name, retained_size FROM leak_suspects</code><br>
                    <code>:info 12345</code>
                </div>
            </div>
            <div class="query-results" id="query-results"></div>
        </div>
    </div>

    <!-- Tab 8: Compare -->
    <div id="tab-compare" class="tab-content">
        <div class="compare-controls">
            <label for="compare-select" style="font-size:13px; margin-right:8px;">Baseline file:</label>
            <select class="compare-select" id="compare-select">
                <option value="">-- Select a baseline --</option>
            </select>
            <button class="btn" id="compare-btn" disabled>Compare</button>
            <span class="compare-status" id="compare-status"></span>
        </div>
        <div id="compare-results"></div>
    </div>

    <!-- Tab 9: AI Chat -->
    <div id="tab-chat" class="tab-content">
        <div class="chat-container">
            <div class="chat-messages" id="chat-messages">
                <div class="chat-placeholder" id="chat-placeholder">
                    Ask questions about your heap dump analysis.<br>
                    Configure your API key in Settings > HeapLens to get started.
                </div>
            </div>
            <div class="chat-input-row">
                <textarea class="chat-input" id="chat-input" placeholder="Ask about your heap dump..." rows="1"></textarea>
                <button class="chat-send" id="chat-send">Send</button>
            </div>
        </div>
    </div>

    <div id="gc-path-container"></div>
    <div id="inspector-panel" class="inspector-panel"></div>
    <div class="source-toast" id="source-toast"></div>

    <script src="${d3Uri}"></script>
    <script>
    (function() {
        const vscode = acquireVsCodeApi();

        // State
        let analysisData = null;
        let histogramSortCol = 'retained_size';
        let histogramSortAsc = false;
        let histogramFilter = '';
        const depInfoCache = {};

        // Source tab state
        let sourceSortCol = 'retained_size';
        let sourceSortAsc = false;
        let sourceFilter = '';
        const sourceStatusMap = {};

        // ---- Tab switching ----
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
                document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
                btn.classList.add('active');
                document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
                if (btn.dataset.tab === 'compare') {
                    vscode.postMessage({ command: 'listAnalyzedFiles' });
                }
            });
        });

        // ---- Message handling ----
        window.addEventListener('message', event => {
            const msg = event.data;
            switch (msg.command) {
                case 'analysisComplete':
                    analysisData = msg;
                    renderOverview(msg);
                    renderHistogram(msg.classHistogram || []);
                    renderDominatorTree(msg.topLayers || []);
                    renderLeakSuspects(msg.leakSuspects || []);
                    renderWaste(msg.wasteAnalysis);
                    renderSourceTab(msg.classHistogram || []);
                    break;
                case 'childrenResponse':
                    expandTreeNode(msg.objectId, msg.children);
                    break;
                case 'noChildren':
                    console.log('[HeapLens] noChildren received for:', msg.objectId);
                    markLeaf(msg.objectId);
                    break;
                case 'sourceNotFound':
                    showSourceToast(msg.className);
                    sourceStatusMap[msg.className] = 'not-found';
                    updateSourceRow(msg.className);
                    break;
                case 'dependencyResolved':
                    depInfoCache[msg.className] = { tier: msg.tier, dependency: msg.dependency };
                    updateDependencyBadges(msg.className, msg.tier, msg.dependency);
                    sourceStatusMap[msg.className] = 'found';
                    updateSourceRow(msg.className);
                    break;
                case 'gcRootPathResponse':
                    renderGcRootPath(msg.path);
                    break;
                case 'inspectObjectResponse':
                    renderInspectorFields(msg.objectId, msg.fields);
                    break;
                case 'reportCopied':
                    showReportCopied();
                    break;
                case 'queryResult':
                    renderQueryResult(msg.result, msg.query);
                    break;
                case 'queryError':
                    renderQueryError(msg.error, msg.query);
                    break;
                case 'analyzedFiles':
                    populateBaselineDropdown(msg.files || []);
                    break;
                case 'compareResult':
                    renderCompareResult(msg.result);
                    break;
                case 'compareError':
                    renderCompareError(msg.error);
                    break;
                case 'explainChunk': {
                    const area = document.getElementById('inspector-explain-area');
                    if (area) {
                        area.textContent += msg.text;
                        area.scrollTop = area.scrollHeight;
                    }
                    break;
                }
                case 'explainDone': {
                    const area = document.getElementById('inspector-explain-area');
                    if (area) area.classList.remove('streaming');
                    const btn = document.getElementById('inspector-explain-btn');
                    if (btn) { btn.textContent = 'Explain this object'; btn.disabled = false; }
                    break;
                }
                case 'explainError': {
                    const area = document.getElementById('inspector-explain-area');
                    if (area) {
                        area.classList.remove('streaming');
                        area.classList.add('error', 'visible');
                        area.textContent = msg.message || 'An error occurred';
                    }
                    const btn = document.getElementById('inspector-explain-btn');
                    if (btn) { btn.textContent = 'Explain this object'; btn.disabled = false; }
                    break;
                }
                case 'explainLeakChunk': {
                    const sanitizedId = msg.className.replace(/[^a-zA-Z0-9]/g, '_');
                    const area = document.getElementById('explain-' + sanitizedId);
                    if (area) {
                        area.textContent += msg.text;
                        area.scrollTop = area.scrollHeight;
                    }
                    break;
                }
                case 'explainLeakDone': {
                    const sanitizedId = msg.className.replace(/[^a-zA-Z0-9]/g, '_');
                    const area = document.getElementById('explain-' + sanitizedId);
                    if (area) area.classList.remove('streaming');
                    // Reset the link text
                    document.querySelectorAll('.suspect-explain-link[data-class="' + msg.className + '"]').forEach(function(link) {
                        link.textContent = 'Explain';
                    });
                    break;
                }
                case 'explainLeakError': {
                    const sanitizedId = msg.className.replace(/[^a-zA-Z0-9]/g, '_');
                    const area = document.getElementById('explain-' + sanitizedId);
                    if (area) {
                        area.classList.remove('streaming');
                        area.classList.add('error', 'visible');
                        area.textContent = msg.message || 'An error occurred';
                    }
                    document.querySelectorAll('.suspect-explain-link[data-class="' + msg.className + '"]').forEach(function(link) {
                        link.textContent = 'Explain';
                    });
                    break;
                }
                case 'error':
                    showError(msg.message);
                    break;
            }
        });

        vscode.postMessage({ command: 'ready' });

        // ---- Helpers ----
        function fmt(bytes) {
            if (bytes === 0) return '0 B';
            const k = 1024;
            const sizes = ['B', 'KB', 'MB', 'GB'];
            const i = Math.floor(Math.log(bytes) / Math.log(k));
            return (bytes / Math.pow(k, i)).toFixed(i > 1 ? 2 : 0) + ' ' + sizes[i];
        }

        function fmtNum(n) {
            return n.toLocaleString();
        }

        function showError(message) {
            document.getElementById('stats-bar').innerHTML =
                '<div class="loading" style="color: var(--vscode-editorError-foreground);">Error: ' + escapeHtml(message) + '</div>';
        }

        function escapeHtml(str) {
            const div = document.createElement('div');
            div.textContent = str;
            return div.innerHTML;
        }

        function isResolvableClass(className) {
            if (!className) return false;
            const primArrays = ['byte[]','short[]','int[]','long[]','float[]','double[]','char[]','boolean[]'];
            if (primArrays.indexOf(className) !== -1) return false;
            const prefixes = ['java.','javax.','sun.','com.sun.','jdk.'];
            for (let i = 0; i < prefixes.length; i++) {
                if (className.indexOf(prefixes[i]) === 0) return false;
            }
            return true;
        }

        let toastTimer = null;
        function showSourceToast(className) {
            const toast = document.getElementById('source-toast');
            toast.textContent = 'No source found for ' + className + '. Open a Java project with source files in this workspace.';
            toast.classList.add('visible');
            if (toastTimer) clearTimeout(toastTimer);
            toastTimer = setTimeout(() => toast.classList.remove('visible'), 5000);
        }

        function makeBadgeHtml(tier, dep) {
            let text, tooltip, cls;
            if (tier === 'workspace') {
                text = 'workspace';
                tooltip = 'Resolved from workspace source';
                cls = 'dep-badge workspace';
            } else {
                text = dep ? dep.artifactId + ':' + dep.version : tier;
                tooltip = dep ? dep.groupId + ':' + dep.artifactId + ':' + dep.version + ' (' + tier + ')' : tier;
                cls = 'dep-badge' + (tier === 'decompiled' ? ' decompiled' : '');
            }
            return '<span class="' + cls + '" title="' + escapeHtml(tooltip) + '">' + escapeHtml(text) + '</span>';
        }

        function updateDependencyBadges(className, tier, dep) {
            const badgeHtml = makeBadgeHtml(tier, dep);

            // Update leak suspect cards
            document.querySelectorAll('.go-to-source-link[data-class="' + className + '"]').forEach(function(link) {
                // Remove existing badge if present
                const existing = link.parentElement.querySelector('.dep-badge');
                if (existing) existing.remove();
                link.insertAdjacentHTML('afterend', badgeHtml);
            });

            // Update dominator tree rows
            document.querySelectorAll('.tree-row').forEach(function(row) {
                const nameEl = row.querySelector('.tree-name');
                if (nameEl && nameEl.textContent === className) {
                    // Remove existing badge if present
                    const existing = row.querySelector('.dep-badge');
                    if (existing) existing.remove();
                    const sourceEl = row.querySelector('.tree-source');
                    if (sourceEl) {
                        sourceEl.insertAdjacentHTML('afterend', badgeHtml);
                    }
                }
            });
        }

        // ---- Tab 1: Overview ----
        function renderOverview(data) {
            const s = data.summary;
            if (s) {
                document.getElementById('stats-bar').innerHTML = [
                    { label: 'Reachable Heap', value: fmt(s.reachable_heap_size || s.total_heap_size) },
                    { label: 'Total Heap', value: fmt(s.total_heap_size) },
                    { label: 'Objects', value: fmtNum(s.total_instances) },
                    { label: 'Classes', value: fmtNum(s.total_classes) },
                    { label: 'Arrays', value: fmtNum(s.total_arrays) },
                    { label: 'GC Roots', value: fmtNum(s.total_gc_roots) }
                ].map(c => '<div class="stat-card"><div class="label">' + c.label + '</div><div class="value">' + c.value + '</div></div>').join('');
            }

            // Top 10 objects table
            const objs = (data.topObjects || []).filter(o => o.node_type !== 'Class' && o.node_type !== 'SuperRoot' && o.retained_size > 0).slice(0, 10);
            let html = '<table><thead><tr><th>#</th><th>Class</th><th>Type</th><th class="right">Shallow</th><th class="right">Retained</th></tr></thead><tbody>';
            objs.forEach((o, i) => {
                html += '<tr><td>' + (i+1) + '</td><td>' + escapeHtml(o.class_name || o.node_type) + '</td><td>' + o.node_type + '</td><td class="right">' + fmt(o.shallow_size) + '</td><td class="right">' + fmt(o.retained_size) + '</td></tr>';
            });
            html += '</tbody></table>';
            document.getElementById('top-objects-table').innerHTML = html;

            // Pie chart
            renderPieChart(objs);

            // Show report button
            document.getElementById('report-actions').style.display = 'block';

            // Auto-diagnosis
            renderDiagnosis(data);
        }

        function renderPieChart(objs) {
            if (typeof d3 === 'undefined' || objs.length === 0) return;
            const container = document.getElementById('pie-chart');
            container.innerHTML = '';
            const w = 400, h = 400, r = Math.min(w, h) / 2;

            const svg = d3.select(container).append('svg').attr('width', w).attr('height', h);
            const g = svg.append('g').attr('transform', 'translate(' + w/2 + ',' + h/2 + ')');

            const color = d3.scaleOrdinal(d3.schemeCategory10);
            const pie = d3.pie().value(d => d.retained_size).sort(null);
            const arc = d3.arc().innerRadius(r * 0.4).outerRadius(r - 10);

            const arcs = g.selectAll('path').data(pie(objs)).enter().append('path')
                .attr('d', arc)
                .attr('fill', (d, i) => color(i))
                .attr('stroke', 'var(--vscode-editor-background)')
                .attr('stroke-width', 2)
                .style('opacity', 0.85);

            arcs.append('title').text(d => (d.data.class_name || d.data.node_type) + ': ' + fmt(d.data.retained_size));
        }

        // ---- Tab 2: Histogram ----
        const HISTOGRAM_PAGE_SIZE = 200;
        let histogramShowAll = false;

        function renderHistogram(histogram) {
            const container = document.getElementById('histogram-table');
            let sorted = [...histogram];

            sorted.sort((a, b) => {
                const va = a[histogramSortCol], vb = b[histogramSortCol];
                if (typeof va === 'string') return histogramSortAsc ? va.localeCompare(vb) : vb.localeCompare(va);
                return histogramSortAsc ? va - vb : vb - va;
            });

            if (histogramFilter) {
                const f = histogramFilter.toLowerCase();
                sorted = sorted.filter(e => e.class_name.toLowerCase().includes(f));
            }

            const totalCount = sorted.length;
            const displayRows = histogramShowAll ? sorted : sorted.slice(0, HISTOGRAM_PAGE_SIZE);

            const cols = [
                { key: 'class_name', label: 'Class Name', cls: '' },
                { key: 'instance_count', label: 'Instances', cls: 'right' },
                { key: 'shallow_size', label: 'Shallow Size', cls: 'right' },
                { key: 'retained_size', label: 'Retained Size', cls: 'right' }
            ];

            let html = '<table><thead><tr>';
            cols.forEach(c => {
                const arrow = histogramSortCol === c.key ? (histogramSortAsc ? ' ▲' : ' ▼') : '';
                html += '<th class="' + c.cls + '" data-sort="' + c.key + '">' + c.label + '<span class="sort-arrow">' + arrow + '</span></th>';
            });
            html += '</tr></thead><tbody>';

            displayRows.forEach(e => {
                html += '<tr><td>' + escapeHtml(e.class_name) + '</td><td class="right">' + fmtNum(e.instance_count) + '</td><td class="right">' + fmt(e.shallow_size) + '</td><td class="right">' + fmt(e.retained_size) + '</td></tr>';
            });
            html += '</tbody></table>';

            if (!histogramShowAll && totalCount > HISTOGRAM_PAGE_SIZE) {
                html += '<div style="text-align:center;padding:12px;"><button id="show-all-histogram" style="padding:6px 16px;cursor:pointer;background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;border-radius:3px;">Show all ' + totalCount.toLocaleString() + ' classes</button></div>';
            }

            container.innerHTML = html;

            // "Show all" button handler
            const showAllBtn = document.getElementById('show-all-histogram');
            if (showAllBtn) {
                showAllBtn.addEventListener('click', () => {
                    histogramShowAll = true;
                    renderHistogram(histogram);
                });
            }

            // Sort click handlers
            container.querySelectorAll('th[data-sort]').forEach(th => {
                th.addEventListener('click', () => {
                    const col = th.dataset.sort;
                    if (histogramSortCol === col) histogramSortAsc = !histogramSortAsc;
                    else { histogramSortCol = col; histogramSortAsc = false; }
                    histogramShowAll = false; // reset pagination on re-sort
                    renderHistogram(histogram);
                });
            });
        }

        document.getElementById('histogram-search').addEventListener('input', (e) => {
            histogramFilter = e.target.value;
            if (analysisData) renderHistogram(analysisData.classHistogram || []);
        });

        // ---- Tab 3: Dominator Tree ----
        let treeData = [];
        let totalRetained = 0;

        const PRIMITIVE_ARRAYS = new Set([
            'byte[]', 'short[]', 'int[]', 'long[]',
            'float[]', 'double[]', 'char[]', 'boolean[]'
        ]);

        function isLeafType(obj) {
            return PRIMITIVE_ARRAYS.has(obj.class_name);
        }

        function renderDominatorTree(layers) {
            treeData = layers.filter(o => o.node_type !== 'Class' && o.node_type !== 'SuperRoot' && o.retained_size > 0);
            totalRetained = treeData.reduce((sum, o) => sum + o.retained_size, 0);

            document.getElementById('domtree-header').style.display = treeData.length > 0 ? 'block' : 'none';
            document.getElementById('reset-tree-btn').style.display = treeData.length > 0 ? 'inline-block' : 'none';

            const container = document.getElementById('dominator-tree');
            container.innerHTML = '';

            treeData.forEach(obj => {
                container.appendChild(createTreeRow(obj, 0));
            });
        }

        function createTreeRow(obj, depth) {
            const leaf = isLeafType(obj);
            const row = document.createElement('div');
            row.className = 'tree-row' + (leaf ? '' : ' expandable');
            row.style.paddingLeft = (12 + depth * 20) + 'px';
            row.dataset.objectId = obj.object_id;
            row.dataset.depth = depth;

            const pct = totalRetained > 0 ? ((obj.retained_size / totalRetained) * 100) : 0;
            const pctStr = pct.toFixed(1);
            const barWidth = Math.max(1, Math.min(100, pct));
            const displayName = obj.class_name || obj.node_type;
            const typeCls = obj.node_type === 'Array' ? 'array' : 'instance';

            const showSource = (obj.node_type === 'Instance' || obj.node_type === 'Array') && isResolvableClass(displayName);

            const cachedDep = depInfoCache[displayName];
            const depBadge = cachedDep ? makeBadgeHtml(cachedDep.tier, cachedDep.dependency) : '';

            const showPin = obj.object_id > 0;
            const showInspect = obj.node_type === 'Instance' && obj.object_id > 0;
            const fieldNameHtml = obj.field_name ? '<span class="tree-field-name">' + escapeHtml(obj.field_name) + ' =</span>' : '';

            row.innerHTML =
                '<span class="tree-toggle">' + (leaf ? '' : '▶') + '</span>' +
                fieldNameHtml +
                '<span class="tree-name">' + escapeHtml(displayName) + '</span>' +
                '<span class="tree-type ' + typeCls + '">' + obj.node_type + '</span>' +
                '<span class="tree-shallow">' + fmt(obj.shallow_size) + '</span>' +
                '<span class="tree-size">' + fmt(obj.retained_size) + '</span>' +
                '<span class="tree-bar-wrap"><div class="tree-bar" style="width:' + barWidth + '%"></div></span>' +
                '<span class="tree-pct">' + pctStr + '%</span>' +
                (showPin ? '<span class="tree-pin" title="Show GC root path">&#x1F4CD;</span>' : '') +
                (showInspect ? '<span class="tree-inspect" title="Inspect fields">&#x1F50D;</span>' : '') +
                (showSource ? '<span class="tree-source" title="Go to source">&#8599;</span>' : '') +
                depBadge;

            if (!leaf) {
                row.addEventListener('click', () => {
                    const toggle = row.querySelector('.tree-toggle');
                    const childContainer = row.nextElementSibling;

                    if (childContainer && childContainer.classList.contains('tree-children')) {
                        childContainer.style.display = childContainer.style.display === 'none' ? 'block' : 'none';
                        toggle.textContent = childContainer.style.display === 'none' ? '▶' : '▼';
                    } else if (toggle.textContent !== '·') {
                        toggle.textContent = '⏳';
                        vscode.postMessage({ command: 'getChildren', objectId: obj.object_id });
                    }
                });
            }

            if (showPin) {
                row.querySelector('.tree-pin').addEventListener('click', (e) => {
                    e.stopPropagation();
                    vscode.postMessage({ command: 'gcRootPath', objectId: obj.object_id });
                });
            }

            if (showInspect) {
                row.querySelector('.tree-inspect').addEventListener('click', (e) => {
                    e.stopPropagation();
                    openInspector(obj.object_id, displayName, obj.shallow_size, obj.retained_size);
                });
            }

            if (showSource) {
                row.querySelector('.tree-source').addEventListener('click', (e) => {
                    e.stopPropagation();
                    vscode.postMessage({ command: 'goToSource', className: displayName });
                });
            }

            return row;
        }

        function expandTreeNode(objectId, children) {
            const rows = document.querySelectorAll('.tree-row[data-object-id="' + objectId + '"]');
            rows.forEach(row => {
                const toggle = row.querySelector('.tree-toggle');
                const existing = row.nextElementSibling;
                if (existing && existing.classList.contains('tree-children')) {
                    existing.remove();
                }

                const depth = parseInt(row.dataset.depth || '0') + 1;
                const filtered = children.filter(c => c.node_type !== 'Class' && c.retained_size > 0);

                if (filtered.length === 0) {
                    toggle.textContent = '·';
                    row.classList.remove('expandable');
                    return;
                }

                toggle.textContent = '▼';

                const childContainer = document.createElement('div');
                childContainer.className = 'tree-children';

                filtered.forEach(child => {
                    childContainer.appendChild(createTreeRow(child, depth));
                });

                row.after(childContainer);
            });
        }

        function markLeaf(objectId) {
            const selector = '.tree-row[data-object-id="' + objectId + '"]';
            const rows = document.querySelectorAll(selector);
            console.log('[HeapLens] markLeaf:', objectId, 'selector:', selector, 'matched:', rows.length);
            rows.forEach(row => {
                const toggle = row.querySelector('.tree-toggle');
                toggle.textContent = '·';
                row.classList.remove('expandable');
            });
        }

        document.getElementById('reset-tree-btn').addEventListener('click', () => {
            if (analysisData) renderDominatorTree(analysisData.topLayers || []);
        });

        // ---- Tab 5: Source ----
        let sourceHistogram = [];

        function renderSourceTab(histogram) {
            sourceHistogram = histogram.filter(e => isResolvableClass(e.class_name));

            // Deduplicate by class name (keep entry with largest retained_size)
            const seen = {};
            sourceHistogram = sourceHistogram.filter(e => {
                if (seen[e.class_name]) return false;
                seen[e.class_name] = true;
                return true;
            });

            renderSourceTable();
        }

        function renderSourceTable() {
            const container = document.getElementById('source-table');
            let sorted = [...sourceHistogram];

            sorted.sort((a, b) => {
                const va = a[sourceSortCol], vb = b[sourceSortCol];
                if (typeof va === 'string') return sourceSortAsc ? va.localeCompare(vb) : vb.localeCompare(va);
                return sourceSortAsc ? va - vb : vb - va;
            });

            if (sourceFilter) {
                const f = sourceFilter.toLowerCase();
                sorted = sorted.filter(e => e.class_name.toLowerCase().includes(f));
            }

            // Update stats
            const resolvedCount = sourceHistogram.filter(e => sourceStatusMap[e.class_name] === 'found').length;
            document.getElementById('source-stats').textContent =
                sorted.length + ' resolvable class' + (sorted.length !== 1 ? 'es' : '') +
                ' \\u00b7 ' + resolvedCount + ' resolved';

            const cols = [
                { key: 'class_name', label: 'Class Name', cls: '' },
                { key: 'instance_count', label: 'Instances', cls: 'right' },
                { key: 'retained_size', label: 'Retained Size', cls: 'right' },
                { key: '_status', label: 'Status', cls: '' },
                { key: '_action', label: '', cls: '' }
            ];

            let html = '<table><thead><tr>';
            cols.forEach(c => {
                if (c.key.startsWith('_')) {
                    html += '<th class="' + c.cls + '">' + c.label + '</th>';
                } else {
                    const arrow = sourceSortCol === c.key ? (sourceSortAsc ? ' \\u25B2' : ' \\u25BC') : '';
                    html += '<th class="' + c.cls + '" data-source-sort="' + c.key + '">' + c.label + '<span class="sort-arrow">' + arrow + '</span></th>';
                }
            });
            html += '</tr></thead><tbody>';

            sorted.forEach(e => {
                const cn = e.class_name;
                const status = sourceStatusMap[cn] || 'not-tried';
                const cachedDep = depInfoCache[cn];
                const badge = cachedDep ? ' ' + makeBadgeHtml(cachedDep.tier, cachedDep.dependency) : '';
                const statusLabel = status === 'not-tried' ? '' : status === 'resolving' ? 'resolving...' : status === 'found' ? 'found' : 'not found';
                const btnDisabled = status === 'resolving' || status === 'found' ? ' disabled' : '';

                html += '<tr data-source-class="' + escapeHtml(cn) + '">' +
                    '<td>' + escapeHtml(cn) + '</td>' +
                    '<td class="right">' + fmtNum(e.instance_count) + '</td>' +
                    '<td class="right">' + fmt(e.retained_size) + '</td>' +
                    '<td><span class="source-status ' + status + '"></span>' + statusLabel + badge + '</td>' +
                    '<td><button class="source-view-btn" data-class="' + escapeHtml(cn) + '"' + btnDisabled + '>View Source</button></td>' +
                    '</tr>';
            });
            html += '</tbody></table>';
            container.innerHTML = html;

            // Sort click handlers
            container.querySelectorAll('th[data-source-sort]').forEach(th => {
                th.addEventListener('click', () => {
                    const col = th.dataset.sourceSort;
                    if (sourceSortCol === col) sourceSortAsc = !sourceSortAsc;
                    else { sourceSortCol = col; sourceSortAsc = false; }
                    renderSourceTable();
                });
            });

            // View Source click handlers
            container.querySelectorAll('.source-view-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const cn = btn.dataset.class;
                    if (sourceStatusMap[cn] === 'found') return;
                    sourceStatusMap[cn] = 'resolving';
                    updateSourceRow(cn);
                    vscode.postMessage({ command: 'goToSource', className: cn });
                });
            });
        }

        function updateSourceRow(className) {
            const row = document.querySelector('tr[data-source-class="' + className + '"]');
            if (!row) return;

            const status = sourceStatusMap[className] || 'not-tried';
            const cachedDep = depInfoCache[className];
            const badge = cachedDep ? ' ' + makeBadgeHtml(cachedDep.tier, cachedDep.dependency) : '';
            const statusLabel = status === 'not-tried' ? '' : status === 'resolving' ? 'resolving...' : status === 'found' ? 'found' : 'not found';

            // Update status cell (4th td)
            const cells = row.querySelectorAll('td');
            if (cells.length >= 4) {
                cells[3].innerHTML = '<span class="source-status ' + status + '"></span>' + statusLabel + badge;
            }

            // Update button state (5th td)
            if (cells.length >= 5) {
                const btn = cells[4].querySelector('.source-view-btn');
                if (btn) btn.disabled = (status === 'resolving' || status === 'found');
            }

            // Update resolved count in stats
            const resolvedCount = sourceHistogram.filter(e => sourceStatusMap[e.class_name] === 'found').length;
            const statsEl = document.getElementById('source-stats');
            if (statsEl) {
                const total = sourceFilter
                    ? sourceHistogram.filter(e => e.class_name.toLowerCase().includes(sourceFilter.toLowerCase())).length
                    : sourceHistogram.length;
                statsEl.textContent = total + ' resolvable class' + (total !== 1 ? 'es' : '') +
                    ' \\u00b7 ' + resolvedCount + ' resolved';
            }
        }

        document.getElementById('source-search').addEventListener('input', (e) => {
            sourceFilter = e.target.value;
            if (analysisData) renderSourceTable();
        });

        // ---- Tab 6: AI Chat ----
        const chatMessages = document.getElementById('chat-messages');
        const chatInput = document.getElementById('chat-input');
        const chatSend = document.getElementById('chat-send');
        const chatPlaceholder = document.getElementById('chat-placeholder');
        let currentAssistantBubble = null;
        let isChatStreaming = false;

        function addChatBubble(role, text) {
            if (chatPlaceholder) chatPlaceholder.style.display = 'none';
            const bubble = document.createElement('div');
            bubble.className = 'chat-bubble ' + role;
            bubble.textContent = text;
            chatMessages.appendChild(bubble);
            chatMessages.scrollTop = chatMessages.scrollHeight;
            return bubble;
        }

        function sendChatMessage() {
            const text = chatInput.value.trim();
            if (!text || isChatStreaming) return;

            addChatBubble('user', text);
            chatInput.value = '';
            chatInput.style.height = 'auto';

            // Create empty assistant bubble for streaming
            currentAssistantBubble = addChatBubble('assistant', '');
            isChatStreaming = true;
            chatSend.disabled = true;

            vscode.postMessage({ command: 'chatMessage', text: text });
        }

        chatSend.addEventListener('click', sendChatMessage);
        chatInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendChatMessage();
            }
        });

        // Auto-resize textarea
        chatInput.addEventListener('input', () => {
            chatInput.style.height = 'auto';
            chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + 'px';
        });

        // Handle chat streaming messages
        window.addEventListener('message', event => {
            const msg = event.data;
            if (msg.command === 'chatChunk' && currentAssistantBubble) {
                currentAssistantBubble.textContent += msg.text;
                chatMessages.scrollTop = chatMessages.scrollHeight;
            } else if (msg.command === 'chatDone') {
                isChatStreaming = false;
                chatSend.disabled = false;
                currentAssistantBubble = null;
            } else if (msg.command === 'chatError') {
                isChatStreaming = false;
                chatSend.disabled = false;
                currentAssistantBubble = null;
                addChatBubble('error', msg.message || 'An error occurred');
            }
        });

        // ---- Tab 5: Waste ----
        function renderWaste(wasteAnalysis) {
            const summaryBar = document.getElementById('waste-summary-bar');
            const dupTitle = document.getElementById('waste-dup-title');
            const dupTable = document.getElementById('waste-dup-table');
            const emptyTitle = document.getElementById('waste-empty-title');
            const emptyTable = document.getElementById('waste-empty-table');

            if (!wasteAnalysis) {
                summaryBar.innerHTML = '<div class="loading">No waste analysis data available</div>';
                return;
            }

            const w = wasteAnalysis;

            // Summary cards
            summaryBar.innerHTML = [
                { label: 'Total Waste', value: fmt(w.total_wasted_bytes), highlight: w.waste_percentage > 5 },
                { label: '% of Heap', value: w.waste_percentage.toFixed(1) + '%', highlight: w.waste_percentage > 10 },
                { label: 'Dup Strings', value: fmt(w.duplicate_string_wasted_bytes), highlight: false },
                { label: 'Empty Collections', value: fmt(w.empty_collection_wasted_bytes), highlight: false }
            ].map(function(c) {
                return '<div class="waste-stat-card"><div class="label">' + c.label + '</div><div class="value' + (c.highlight ? ' highlight' : '') + '">' + c.value + '</div></div>';
            }).join('');

            // Duplicate strings table
            var dups = w.duplicate_strings || [];
            if (dups.length > 0) {
                dupTitle.style.display = 'block';
                var html = '<table><thead><tr><th>Preview</th><th class="right">Copies</th><th class="right">Wasted</th><th class="right">Total</th></tr></thead><tbody>';
                dups.forEach(function(d) {
                    var preview = d.preview || '(empty)';
                    html += '<tr><td><span class="waste-preview" title="' + escapeHtml(preview) + '">' + escapeHtml(preview) + '</span></td>'
                        + '<td class="right">' + fmtNum(d.count) + '</td>'
                        + '<td class="right">' + fmt(d.wasted_bytes) + '</td>'
                        + '<td class="right">' + fmt(d.total_bytes) + '</td></tr>';
                });
                html += '</tbody></table>';
                dupTable.innerHTML = html;
            } else {
                dupTitle.style.display = 'none';
                dupTable.innerHTML = '';
            }

            // Empty collections table
            var empties = w.empty_collections || [];
            if (empties.length > 0) {
                emptyTitle.style.display = 'block';
                var ehtml = '<table><thead><tr><th>Class</th><th class="right">Count</th><th class="right">Wasted</th></tr></thead><tbody>';
                empties.forEach(function(e) {
                    ehtml += '<tr><td>' + escapeHtml(e.class_name) + '</td>'
                        + '<td class="right">' + fmtNum(e.count) + '</td>'
                        + '<td class="right">' + fmt(e.wasted_bytes) + '</td></tr>';
                });
                ehtml += '</tbody></table>';
                emptyTable.innerHTML = ehtml;
            } else {
                emptyTitle.style.display = 'none';
                emptyTable.innerHTML = '';
            }
        }

        // ---- Tab 4: Leak Suspects ----
        function renderLeakSuspects(suspects) {
            const container = document.getElementById('leak-suspects');
            if (!suspects || suspects.length === 0) {
                container.innerHTML = '<div class="loading">No leak suspects detected (no single object or class retains >10% of heap)</div>';
                return;
            }

            container.innerHTML = suspects.map(s => {
                const severity = s.retained_percentage > 30 ? 'high' : 'medium';
                const sourceLink = isResolvableClass(s.class_name)
                    ? ' | <a class="go-to-source-link" data-class="' + escapeHtml(s.class_name) + '">View Source</a>'
                    : '';
                const gcPathLink = s.object_id
                    ? ' | <a class="gc-path-link" data-object-id="' + s.object_id + '" style="cursor:pointer;color:var(--vscode-textLink-foreground);">GC Path</a>'
                    : '';
                const cachedDep = depInfoCache[s.class_name];
                const depBadge = cachedDep ? makeBadgeHtml(cachedDep.tier, cachedDep.dependency) : '';
                const sanitizedId = s.class_name.replace(/[^a-zA-Z0-9]/g, '_');
                const explainLink = ' | <a class="suspect-explain-link" data-class="' + escapeHtml(s.class_name) +
                    '" data-retained="' + s.retained_size +
                    '" data-pct="' + s.retained_percentage +
                    '" data-desc="' + escapeHtml(s.description) +
                    '" data-target="explain-' + sanitizedId + '">Explain</a>';
                return '<div class="suspect-card ' + severity + '" data-class="' + escapeHtml(s.class_name) + '">' +
                    '<div class="suspect-header">' +
                    '<span class="suspect-class">' + escapeHtml(s.class_name) + '</span>' +
                    '<span class="suspect-badge ' + severity + '">' + s.retained_percentage.toFixed(1) + '%</span>' +
                    '</div>' +
                    '<div class="suspect-desc">' + escapeHtml(s.description) + '</div>' +
                    '<div style="margin-top:8px;opacity:0.6;font-size:12px;">Retained: ' + fmt(s.retained_size) +
                    (s.object_id ? ' | Object ID: ' + s.object_id : '') +
                    sourceLink + gcPathLink + explainLink + depBadge + '</div>' +
                    '<div class="suspect-explain-area" id="explain-' + sanitizedId + '"></div>' +
                    '</div>';
            }).join('');

            // Wire up "View Source" click handlers
            container.querySelectorAll('.go-to-source-link').forEach(link => {
                link.addEventListener('click', (e) => {
                    e.preventDefault();
                    vscode.postMessage({ command: 'goToSource', className: link.dataset.class });
                });
            });

            // Wire up "GC Path" click handlers
            container.querySelectorAll('.gc-path-link').forEach(link => {
                link.addEventListener('click', (e) => {
                    e.preventDefault();
                    const objectId = parseInt(link.dataset.objectId, 10);
                    if (objectId) vscode.postMessage({ command: 'gcRootPath', objectId: objectId });
                });
            });

            // Wire up "Explain" click handlers
            container.querySelectorAll('.suspect-explain-link').forEach(link => {
                link.addEventListener('click', (e) => {
                    e.preventDefault();
                    const targetId = link.dataset.target;
                    const area = document.getElementById(targetId);
                    if (!area) return;

                    link.textContent = 'Analyzing...';
                    area.classList.add('visible', 'streaming');
                    area.classList.remove('error');
                    area.textContent = '';

                    vscode.postMessage({
                        command: 'explainLeakSuspect',
                        className: link.dataset.class,
                        retainedSize: parseFloat(link.dataset.retained),
                        retainedPercentage: parseFloat(link.dataset.pct),
                        description: link.dataset.desc
                    });
                });
            });
        }
        // ---- GC Root Path ----
        function closeGcPath() {
            document.getElementById('gc-path-container').innerHTML = '';
        }

        function renderGcRootPath(path) {
            const container = document.getElementById('gc-path-container');
            if (!path || path.length === 0) {
                container.innerHTML = '<div class="gc-path-breadcrumb"><span class="gc-path-label">GC Path</span><span style="opacity:0.5;font-size:12px;">No path to GC root found</span><button class="gc-path-close">&times;</button></div>';
                container.querySelector('.gc-path-close').addEventListener('click', closeGcPath);
                return;
            }

            let html = '<div class="gc-path-breadcrumb"><span class="gc-path-label">GC Path</span>';
            path.forEach(function(node, i) {
                const isRoot = node.node_type === 'Root' || node.node_type === 'SuperRoot';
                const isTarget = i === path.length - 1;
                const cls = isRoot ? 'root' : isTarget ? 'target' : '';
                const label = node.class_name || node.node_type;
                const title = label + ' (' + fmt(node.retained_size) + ')';
                if (i > 0) {
                    if (node.field_name) {
                        html += '<span class="gc-path-arrow">&#9654;</span><span class="gc-path-field">(' + escapeHtml(node.field_name) + ')</span>';
                    } else {
                        html += '<span class="gc-path-arrow">&#9654;</span>';
                    }
                }
                html += '<span class="gc-path-node ' + cls + '" title="' + escapeHtml(title) + '">' + escapeHtml(label) + '</span>';
            });
            html += '<button class="gc-path-close">&times;</button></div>';
            container.innerHTML = html;
            container.querySelector('.gc-path-close').addEventListener('click', closeGcPath);
        }

        // ---- Object Inspector ----
        function openInspector(objectId, className, shallowSize, retainedSize) {
            const panel = document.getElementById('inspector-panel');
            panel.dataset.objectId = objectId;
            panel.dataset.className = className;
            panel.dataset.shallowSize = shallowSize;
            panel.dataset.retainedSize = retainedSize;
            panel.innerHTML = '<div class="inspector-header"><h3>' + escapeHtml(className) + '</h3><button class="inspector-close">&times;</button></div>' +
                '<div style="padding:8px 16px;font-size:11px;opacity:0.6;">Shallow: ' + fmt(shallowSize) + ' | Retained: ' + fmt(retainedSize) + '</div>' +
                '<div class="inspector-loading">Loading fields...</div>';
            panel.classList.add('visible');
            panel.querySelector('.inspector-close').addEventListener('click', closeInspector);
            vscode.postMessage({ command: 'inspectObject', objectId: objectId });
        }

        function closeInspector() {
            const panel = document.getElementById('inspector-panel');
            panel.classList.remove('visible');
            panel.innerHTML = '';
        }

        function renderInspectorFields(objectId, fields) {
            const panel = document.getElementById('inspector-panel');
            if (!panel.classList.contains('visible')) return;

            const body = panel.querySelector('.inspector-loading');
            if (!body) return;

            if (!fields || fields.length === 0) {
                body.innerHTML = '<div style="padding:20px;text-align:center;opacity:0.5;">No fields found</div>';
                body.className = 'inspector-body';
                return;
            }

            let html = '';
            fields.forEach(function(f) {
                let valueHtml = '';
                if (f.primitive_value !== undefined && f.primitive_value !== null) {
                    valueHtml = '<span class="inspector-field-value">' + escapeHtml(String(f.primitive_value)) + '</span>';
                } else if (f.ref_object_id) {
                    const refLabel = f.ref_summary ? f.ref_summary.class_name : '0x' + f.ref_object_id.toString(16);
                    valueHtml = '<span class="inspector-field-value"><span class="inspector-ref-link" data-ref-id="' + f.ref_object_id + '" data-ref-class="' + escapeHtml(refLabel) + '">' + escapeHtml(refLabel) + '</span></span>';
                    if (f.ref_summary) {
                        valueHtml += '<span class="inspector-sizes">' + fmt(f.ref_summary.retained_size) + '</span>';
                    }
                } else {
                    valueHtml = '<span class="inspector-field-value" style="opacity:0.4">—</span>';
                }
                html += '<div class="inspector-field">' +
                    '<span class="inspector-field-name">' + escapeHtml(f.name) + '</span>' +
                    '<span class="inspector-field-type">' + escapeHtml(f.field_type) + '</span>' +
                    valueHtml +
                    '</div>';
            });

            // Add explain button and area
            html += '<button class="inspector-explain-btn" id="inspector-explain-btn">Explain this object</button>';
            html += '<div id="inspector-explain-area" class="inspector-explain-area"></div>';

            body.className = 'inspector-body';
            body.innerHTML = html;

            // Attach click handlers for reference links
            body.querySelectorAll('.inspector-ref-link').forEach(function(link) {
                link.addEventListener('click', function() {
                    const refId = parseInt(link.dataset.refId);
                    const refClass = link.dataset.refClass || '';
                    if (refId > 0) {
                        openInspector(refId, refClass, 0, 0);
                    }
                });
            });

            // Attach explain button handler
            const explainBtn = document.getElementById('inspector-explain-btn');
            const explainArea = document.getElementById('inspector-explain-area');
            if (explainBtn && explainArea) {
                explainBtn.addEventListener('click', function() {
                    explainBtn.disabled = true;
                    explainBtn.textContent = 'Analyzing...';
                    explainArea.classList.add('visible', 'streaming');
                    explainArea.classList.remove('error');
                    explainArea.textContent = '';

                    const panel = document.getElementById('inspector-panel');
                    vscode.postMessage({
                        command: 'explainObject',
                        objectId: parseInt(panel.dataset.objectId),
                        className: panel.dataset.className,
                        shallowSize: parseInt(panel.dataset.shallowSize),
                        retainedSize: parseInt(panel.dataset.retainedSize),
                        fields: fields
                    });
                });
            }
        }

        // ---- Incident Report ----
        document.getElementById('copy-report-btn').addEventListener('click', function() {
            vscode.postMessage({ command: 'copyReport' });
        });

        function showReportCopied() {
            const el = document.getElementById('report-copied');
            el.classList.add('visible');
            setTimeout(function() { el.classList.remove('visible'); }, 3000);
        }

        // ---- Auto-Diagnosis ----
        function getRecommendation(className, severity) {
            const cn = className.toLowerCase();
            if (cn.indexOf('cache') !== -1 || cn.indexOf('cach') !== -1) {
                return severity === 'critical'
                    ? 'Cache is consuming excessive memory. Check eviction policy, consider bounded caches (LRU/LFU), or reduce max size.'
                    : 'Review cache eviction settings and TTL configuration.';
            }
            if (cn.indexOf('pool') !== -1 || cn.indexOf('connection') !== -1 || cn.indexOf('datasource') !== -1) {
                return 'Check for connection leaks. Ensure connections are closed after use. Review pool max size and idle timeout settings.';
            }
            if (cn.indexOf('session') !== -1 || cn.indexOf('httpsession') !== -1) {
                return 'Check session timeout settings. Look for session attributes storing large objects. Consider session size limits.';
            }
            if (cn.indexOf('queue') !== -1 || cn.indexOf('buffer') !== -1 || cn.indexOf('blocking') !== -1) {
                return 'Possible backpressure issue. Check consumer throughput, queue capacity limits, and producer rate.';
            }
            if (cn.indexOf('thread') !== -1) {
                return 'Check for thread pool exhaustion or thread-local leaks. Review pool sizing.';
            }
            if (cn === 'byte[]' || cn === 'char[]') {
                return severity === 'critical'
                    ? 'Large byte/char arrays suggest buffering or serialization issues. Check for unclosed streams, large response bodies, or excessive string operations.'
                    : 'Review buffer sizes and ensure streams are properly closed.';
            }
            if (severity === 'critical') {
                return 'This class retains a very large portion of the heap. Investigate why these objects are not being garbage collected.';
            }
            return 'Consider if the number of instances and retained size are expected for your application workload.';
        }

        function renderDiagnosis(data) {
            const section = document.getElementById('diagnosis-section');
            if (!data.summary || !data.classHistogram) {
                section.innerHTML = '';
                return;
            }

            const totalHeap = data.summary.reachable_heap_size || data.summary.total_heap_size;
            if (totalHeap === 0) { section.innerHTML = ''; return; }

            const findings = [];

            // Check leak suspects
            const suspects = data.leakSuspects || [];
            suspects.forEach(function(s) {
                if (s.retained_percentage > 50) {
                    findings.push({
                        severity: 'critical',
                        title: s.class_name + ' retains ' + s.retained_percentage.toFixed(1) + '% of heap',
                        detail: getRecommendation(s.class_name, 'critical')
                    });
                } else if (s.retained_percentage > 20) {
                    findings.push({
                        severity: 'warning',
                        title: s.class_name + ' retains ' + s.retained_percentage.toFixed(1) + '% of heap',
                        detail: getRecommendation(s.class_name, 'warning')
                    });
                }
            });

            // Check class histogram patterns
            const histogram = data.classHistogram || [];
            histogram.forEach(function(entry) {
                const pct = (entry.retained_size / totalHeap) * 100;
                const cn = entry.class_name;
                const cnLower = cn.toLowerCase();

                // byte[]/char[] > 20% of heap
                if ((cn === 'byte[]' || cn === 'char[]') && pct > 20) {
                    const alreadyReported = findings.some(function(f) { return f.title.indexOf(cn) !== -1; });
                    if (!alreadyReported) {
                        findings.push({
                            severity: 'warning',
                            title: cn + ' occupies ' + pct.toFixed(1) + '% of heap',
                            detail: getRecommendation(cn, 'warning')
                        });
                    }
                }

                // Pattern matching for known problematic classes
                if (pct > 10) {
                    const patterns = ['cache', 'pool', 'connection', 'session', 'queue', 'buffer'];
                    patterns.forEach(function(pat) {
                        if (cnLower.indexOf(pat) !== -1) {
                            const alreadyReported = findings.some(function(f) { return f.title.indexOf(cn) !== -1; });
                            if (!alreadyReported) {
                                findings.push({
                                    severity: pct > 30 ? 'critical' : 'warning',
                                    title: cn + ' pattern detected (' + pct.toFixed(1) + '% heap)',
                                    detail: getRecommendation(cn, pct > 30 ? 'critical' : 'warning')
                                });
                            }
                        }
                    });
                }

                // Instance count > 100K with > 3% heap
                if (entry.instance_count > 100000 && pct > 3) {
                    const alreadyReported = findings.some(function(f) { return f.title.indexOf(cn) !== -1; });
                    if (!alreadyReported) {
                        findings.push({
                            severity: 'info',
                            title: fmtNum(entry.instance_count) + ' instances of ' + cn + ' (' + pct.toFixed(1) + '% heap)',
                            detail: 'High instance count may indicate object accumulation. Check if objects are being properly released.'
                        });
                    }
                }
            });

            // Sort: critical > warning > info
            const order = { critical: 0, warning: 1, info: 2 };
            findings.sort(function(a, b) { return order[a.severity] - order[b.severity]; });

            if (findings.length === 0) {
                section.innerHTML = '';
                return;
            }

            let html = '<div class="section-title">Auto-Diagnosis</div>';
            findings.forEach(function(f) {
                html += '<div class="diagnosis-card ' + f.severity + '">' +
                    '<div class="diagnosis-severity">' + f.severity.toUpperCase() + '</div>' +
                    '<div class="diagnosis-title">' + escapeHtml(f.title) + '</div>' +
                    '<div class="diagnosis-detail">' + escapeHtml(f.detail) + '</div>' +
                    '</div>';
            });
            section.innerHTML = html;
        }

        // ---- Query Tab ----
        const queryInput = document.getElementById('query-input');
        const queryRunBtn = document.getElementById('query-run-btn');
        const queryHelpBtn = document.getElementById('query-help-btn');
        const queryHelp = document.getElementById('query-help');
        const queryStatus = document.getElementById('query-status');
        const queryResults = document.getElementById('query-results');
        const queryHistoryEl = document.getElementById('query-history');
        const queryHistory = [];

        function runQuery() {
            const q = queryInput.value.trim();
            if (!q) return;
            queryStatus.className = 'query-status';
            queryStatus.textContent = 'Running...';
            queryResults.innerHTML = '';
            queryRunBtn.disabled = true;
            vscode.postMessage({ command: 'executeQuery', query: q });
        }

        queryRunBtn.addEventListener('click', runQuery);

        queryInput.addEventListener('keydown', function(e) {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault();
                runQuery();
            }
        });

        queryHelpBtn.addEventListener('click', function() {
            queryHelp.style.display = queryHelp.style.display === 'none' ? 'block' : 'none';
        });

        function addToHistory(q) {
            const idx = queryHistory.indexOf(q);
            if (idx !== -1) queryHistory.splice(idx, 1);
            queryHistory.unshift(q);
            if (queryHistory.length > 10) queryHistory.pop();
            renderQueryHistory();
        }

        function renderQueryHistory() {
            queryHistoryEl.innerHTML = '';
            queryHistory.forEach(function(q) {
                const el = document.createElement('span');
                el.className = 'query-history-item';
                el.textContent = q;
                el.title = q;
                el.addEventListener('click', function() {
                    queryInput.value = q;
                    queryInput.focus();
                });
                queryHistoryEl.appendChild(el);
            });
        }

        function renderQueryResult(result, query) {
            queryRunBtn.disabled = false;
            addToHistory(query);

            const cols = result.columns || [];
            const rows = result.rows || [];
            const scanned = result.total_scanned || 0;
            const matched = result.total_matched || 0;
            const timeMs = (result.execution_time_ms || 0).toFixed(1);

            queryStatus.className = 'query-status';
            queryStatus.textContent = rows.length + ' row' + (rows.length !== 1 ? 's' : '') +
                ' returned (' + matched + ' matched, ' + scanned + ' scanned, ' + timeMs + 'ms)';

            if (rows.length === 0) {
                queryResults.innerHTML = '<div style="opacity:0.5; padding:12px;">No results</div>';
                return;
            }

            // Determine which columns are size columns
            const sizeCols = new Set(['shallow_size', 'retained_size', 'wasted_bytes', 'total_bytes']);

            let html = '<table><thead><tr>';
            cols.forEach(function(col) {
                const isSize = sizeCols.has(col);
                html += '<th' + (isSize ? ' class="right"' : '') + '>' + escapeHtml(col) + '</th>';
            });
            html += '</tr></thead><tbody>';

            rows.forEach(function(row) {
                html += '<tr>';
                row.forEach(function(val, i) {
                    const col = cols[i];
                    const isSize = sizeCols.has(col);
                    let display;
                    if (isSize && typeof val === 'number') {
                        display = fmt(val);
                    } else if (typeof val === 'number' && col === 'retained_percentage') {
                        display = val.toFixed(1) + '%';
                    } else if (typeof val === 'number') {
                        display = fmtNum(val);
                    } else {
                        display = escapeHtml(String(val == null ? '' : val));
                    }
                    html += '<td' + (isSize ? ' class="right"' : '') + '>' + display + '</td>';
                });
                html += '</tr>';
            });

            html += '</tbody></table>';
            queryResults.innerHTML = html;
        }

        function renderQueryError(error, query) {
            queryRunBtn.disabled = false;
            if (query) addToHistory(query);
            queryStatus.className = 'query-status error';
            queryStatus.textContent = 'Error: ' + error;
            queryResults.innerHTML = '';
        }

        // ---- Compare tab ----
        const compareSelect = document.getElementById('compare-select');
        const compareBtn = document.getElementById('compare-btn');
        const compareStatus = document.getElementById('compare-status');
        const compareResults = document.getElementById('compare-results');

        compareSelect.addEventListener('change', function() {
            compareBtn.disabled = !compareSelect.value;
        });

        compareBtn.addEventListener('click', function() {
            if (!compareSelect.value) return;
            compareBtn.disabled = true;
            compareStatus.className = 'compare-status';
            compareStatus.textContent = 'Comparing...';
            compareResults.innerHTML = '';
            vscode.postMessage({
                command: 'compareHeaps',
                baselinePath: compareSelect.value
            });
        });

        function populateBaselineDropdown(files) {
            const current = compareSelect.value;
            compareSelect.innerHTML = '<option value="">-- Select a baseline --</option>';
            files.forEach(function(f) {
                const opt = document.createElement('option');
                opt.value = f;
                // Show just the filename for readability
                const parts = f.replace(/\\\\/g, '/').split('/');
                opt.textContent = parts[parts.length - 1] + ' (' + f + ')';
                compareSelect.appendChild(opt);
            });
            if (current && files.indexOf(current) !== -1) {
                compareSelect.value = current;
            }
            compareBtn.disabled = !compareSelect.value;
            if (files.length === 0) {
                compareStatus.className = 'compare-status';
                compareStatus.textContent = 'No other analyzed files available. Open and analyze another .hprof file first.';
            } else {
                compareStatus.textContent = '';
            }
        }

        function fmtDelta(bytes) {
            if (bytes === 0) return '0 B';
            var sign = bytes > 0 ? '+' : '-';
            var abs = Math.abs(bytes);
            return sign + fmt(abs);
        }

        function deltaClass(value) {
            if (value > 0) return 'delta-positive';
            if (value < 0) return 'delta-negative';
            return 'delta-zero';
        }

        function renderCompareResult(result) {
            compareBtn.disabled = false;
            compareStatus.className = 'compare-status';
            compareStatus.textContent = '';

            var html = '';
            var sd = result.summary_delta;

            // Summary delta cards
            html += '<div class="compare-section-title">Summary Delta</div>';
            html += '<div class="stats-bar">';
            html += compareStatCard('Total Heap', fmt(sd.current_total_heap_size), sd.total_heap_size_delta, true);
            html += compareStatCard('Reachable', fmt(sd.current_reachable_heap_size), sd.reachable_heap_size_delta, true);
            html += compareStatCard('Instances', fmtNum(sd.current_total_instances), sd.total_instances_delta, false);
            html += compareStatCard('Classes', fmtNum(sd.current_total_classes), sd.total_classes_delta, false);
            html += compareStatCard('Arrays', fmtNum(sd.current_total_arrays), sd.total_arrays_delta, false);
            html += compareStatCard('GC Roots', fmtNum(sd.current_total_gc_roots), sd.total_gc_roots_delta, false);
            html += '</div>';

            // Histogram delta table
            var hd = result.histogram_delta || [];
            if (hd.length > 0) {
                var cap = Math.min(hd.length, 200);
                html += '<div class="compare-section-title">Class Changes (' + hd.length + ' classes)</div>';
                html += '<input type="text" class="search-box" id="compare-hist-search" placeholder="Filter by class name...">';
                html += '<div id="compare-hist-table">';
                html += buildCompareHistTable(hd, cap, '');
                html += '</div>';
            }

            // Leak suspect changes
            var lsc = result.leak_suspect_changes || [];
            if (lsc.length > 0) {
                html += '<div class="compare-section-title">Leak Suspect Changes</div>';
                lsc.forEach(function(l) {
                    var cardClass = 'compare-leak-card ' + l.change_type;
                    html += '<div class="' + cardClass + '">';
                    html += '<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">';
                    html += '<span style="font-weight:bold; font-size:14px;">' + escapeHtml(l.class_name) + '</span>';
                    html += '<span class="change-badge ' + l.change_type + '">' + l.change_type + '</span>';
                    html += '</div>';
                    html += '<div style="font-size:13px; opacity:0.8; margin-bottom:4px;">' + escapeHtml(l.description) + '</div>';
                    if (l.change_type === 'persisted' || l.change_type === 'new') {
                        html += '<div style="font-size:12px; opacity:0.7;">';
                        if (l.baseline_retained_size > 0) {
                            html += 'Baseline: ' + fmt(l.baseline_retained_size) + ' (' + l.baseline_retained_percentage.toFixed(1) + '%)';
                            html += ' &rarr; ';
                        }
                        html += 'Current: ' + fmt(l.current_retained_size) + ' (' + l.current_retained_percentage.toFixed(1) + '%)';
                        if (l.retained_size_delta !== 0) {
                            html += ' <span class="' + deltaClass(l.retained_size_delta) + '">(' + fmtDelta(l.retained_size_delta) + ')</span>';
                        }
                        html += '</div>';
                    } else if (l.change_type === 'resolved') {
                        html += '<div style="font-size:12px; opacity:0.7;">Was: ' + fmt(l.baseline_retained_size) + ' (' + l.baseline_retained_percentage.toFixed(1) + '%)</div>';
                    }
                    html += '</div>';
                });
            }

            // Waste delta
            var wd = result.waste_delta;
            if (wd) {
                html += '<div class="compare-section-title">Waste Delta</div>';
                html += '<div class="stats-bar">';
                html += compareStatCard('Total Waste', fmt(wd.current_total_wasted_bytes), wd.total_wasted_delta, true);
                html += compareStatCard('Waste %', wd.current_waste_percentage.toFixed(1) + '%', wd.waste_percentage_delta, false, true);
                html += compareStatCard('Dup. Strings', fmtDelta(wd.duplicate_string_wasted_delta), wd.duplicate_string_wasted_delta, false);
                html += compareStatCard('Empty Colls.', fmtDelta(wd.empty_collection_wasted_delta), wd.empty_collection_wasted_delta, false);
                html += '</div>';
            }

            compareResults.innerHTML = html;

            // Wire up histogram search filter
            var histSearch = document.getElementById('compare-hist-search');
            if (histSearch) {
                histSearch.addEventListener('input', function() {
                    var filter = histSearch.value.toLowerCase();
                    var table = document.getElementById('compare-hist-table');
                    if (table) {
                        table.innerHTML = buildCompareHistTable(hd, 200, filter);
                    }
                });
            }
        }

        function compareStatCard(label, value, delta, isBytes, isPct) {
            var deltaStr;
            if (isPct) {
                deltaStr = (delta >= 0 ? '+' : '') + delta.toFixed(1) + 'pp';
            } else if (isBytes) {
                deltaStr = fmtDelta(delta);
            } else {
                deltaStr = (delta >= 0 ? '+' : '') + fmtNum(delta);
            }
            return '<div class="compare-stat-card">' +
                '<div class="label">' + escapeHtml(label) + '</div>' +
                '<div class="value">' + value + '</div>' +
                '<div class="delta ' + deltaClass(delta) + '">' + deltaStr + '</div>' +
                '</div>';
        }

        function buildCompareHistTable(data, cap, filter) {
            var filtered = data;
            if (filter) {
                filtered = data.filter(function(d) {
                    return d.class_name.toLowerCase().indexOf(filter) !== -1;
                });
            }
            var rows = filtered.slice(0, cap);
            if (rows.length === 0) return '<div style="opacity:0.5; padding:12px;">No matching classes.</div>';

            var html = '<table><thead><tr>';
            html += '<th>Class</th><th>Change</th>';
            html += '<th class="right">Instances (\u0394)</th>';
            html += '<th class="right">Shallow (\u0394)</th>';
            html += '<th class="right">Retained (\u0394)</th>';
            html += '<th class="right">Baseline Ret.</th>';
            html += '<th class="right">Current Ret.</th>';
            html += '</tr></thead><tbody>';

            rows.forEach(function(d) {
                html += '<tr>';
                html += '<td>' + escapeHtml(d.class_name) + '</td>';
                html += '<td><span class="change-badge ' + d.change_type + '">' + d.change_type + '</span></td>';
                html += '<td class="right ' + deltaClass(d.instance_count_delta) + '">' + (d.instance_count_delta >= 0 ? '+' : '') + fmtNum(d.instance_count_delta) + '</td>';
                html += '<td class="right ' + deltaClass(d.shallow_size_delta) + '">' + fmtDelta(d.shallow_size_delta) + '</td>';
                html += '<td class="right ' + deltaClass(d.retained_size_delta) + '">' + fmtDelta(d.retained_size_delta) + '</td>';
                html += '<td class="right">' + fmt(d.baseline_retained_size) + '</td>';
                html += '<td class="right">' + fmt(d.current_retained_size) + '</td>';
                html += '</tr>';
            });

            html += '</tbody></table>';
            if (filtered.length > cap) {
                html += '<div style="opacity:0.5; padding:8px; font-size:12px;">Showing ' + cap + ' of ' + filtered.length + ' classes</div>';
            }
            return html;
        }

        function renderCompareError(error) {
            compareBtn.disabled = false;
            compareStatus.className = 'compare-status error';
            compareStatus.textContent = 'Error: ' + error;
        }
    })();
    </script>
</body>
</html>`;
}
