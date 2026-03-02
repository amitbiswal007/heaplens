import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

const config: Config = {
  title: 'HeapLens',
  tagline: 'LLM-Powered Java Heap Dump Analyzer',
  favicon: 'img/favicon.ico',

  future: {
    v4: true,
  },

  url: 'https://heaplens.dev',
  baseUrl: '/',

  organizationName: 'sachinkg12',
  projectName: 'HeapLens',

  onBrokenLinks: 'throw',

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
          editUrl: 'https://github.com/sachinkg12/HeapLens/tree/main/docs-site/',
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    colorMode: {
      defaultMode: 'dark',
      respectPrefersColorScheme: true,
    },
    navbar: {
      title: 'HeapLens',
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'docsSidebar',
          position: 'left',
          label: 'Documentation',
        },
        {
          href: 'https://github.com/sachinkg12/HeapLens',
          label: 'GitHub',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Documentation',
          items: [
            { label: 'Getting Started', to: '/docs/getting-started/installation' },
            { label: 'Concepts', to: '/docs/concepts/heap-dump-fundamentals' },
            { label: 'Tabs Guide', to: '/docs/tabs-guide/overview-tab' },
          ],
        },
        {
          title: 'Integrations',
          items: [
            { label: 'MCP Server', to: '/docs/mcp/introduction' },
            { label: 'API Reference', to: '/docs/api-reference/rpc-methods' },
          ],
        },
        {
          title: 'More',
          items: [
            { label: 'GitHub', href: 'https://github.com/sachinkg12/HeapLens' },
            { label: 'Runbook', to: '/docs/runbook/troubleshooting' },
          ],
        },
      ],
      copyright: `Copyright \u00a9 ${new Date().getFullYear()} HeapLens Contributors.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ['rust', 'bash', 'json', 'toml'],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
