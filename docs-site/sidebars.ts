import type {SidebarsConfig} from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  docsSidebar: [
    {
      type: 'category',
      label: 'Getting Started',
      items: [
        'getting-started/installation',
        'getting-started/quick-start',
        'getting-started/generating-heap-dumps',
      ],
      collapsed: false,
    },
    {
      type: 'category',
      label: 'Concepts',
      items: [
        'concepts/heap-dump-fundamentals',
        'concepts/dominator-tree',
        'concepts/retained-vs-shallow-size',
        'concepts/gc-roots',
        'concepts/leak-detection',
        'concepts/waste-analysis',
      ],
      collapsed: false,
    },
    {
      type: 'category',
      label: 'Tabs Guide',
      items: [
        'tabs-guide/overview-tab',
        'tabs-guide/histogram-tab',
        'tabs-guide/dominator-tree-tab',
        'tabs-guide/leak-suspects-tab',
        'tabs-guide/waste-tab',
        'tabs-guide/source-tab',
        'tabs-guide/ai-chat-tab',
      ],
      collapsed: false,
    },
    {
      type: 'category',
      label: 'Architecture',
      items: [
        'architecture/system-overview',
        'architecture/rust-backend',
        'architecture/typescript-frontend',
        'architecture/data-flow',
      ],
    },
    {
      type: 'category',
      label: 'MCP Integration',
      items: [
        'mcp/introduction',
        'mcp/setup',
        'mcp/tools-reference',
      ],
    },
    {
      type: 'category',
      label: 'API Reference',
      items: [
        'api-reference/rpc-methods',
        'api-reference/data-structures',
      ],
    },
    {
      type: 'category',
      label: 'Runbook',
      items: [
        'runbook/troubleshooting',
        'runbook/debugging-webview',
        'runbook/performance-tuning',
      ],
    },
  ],
};

export default sidebars;
