import type {ReactNode} from 'react';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import Layout from '@theme/Layout';
import Heading from '@theme/Heading';

import styles from './index.module.css';

/* ── Data ─────────────────────────────────────────────────────────────── */

const stats = [
  {number: '10', label: 'Interactive Views'},
  {number: '10+', label: 'LLM Providers'},
  {number: '< 60s', label: '1 GB Parse Time'},
  {number: 'SQL-like', label: 'HeapQL Queries'},
];

const features = [
  {
    emoji: '\u26A1',
    title: 'High-Performance Rust Engine',
    description:
      'Zero-copy mmap parsing with Lengauer-Tarjan dominator tree computation. 1 GB heap dump parsed in ~60 seconds on Apple M1.',
  },
  {
    emoji: '\uD83D\uDD0D',
    title: '10 Interactive Analysis Views',
    description:
      'Overview, Histogram, Dominator Tree, Leak Suspects, Waste Detection, Source Bridging, HeapQL, Compare, Timeline, and AI Chat.',
  },
  {
    emoji: '\uD83E\uDD16',
    title: 'AI-Native Analysis',
    description:
      'Built-in LLM chat supporting 10+ providers including Claude, GPT, Gemini, and local models via Ollama. Ask questions in plain English.',
  },
  {
    emoji: '\uD83D\uDDC4\uFE0F',
    title: 'HeapQL Query Language',
    description:
      'SQL-like queries purpose-built for heap analysis. Filter by class, size, retained size with autocomplete and syntax highlighting.',
  },
  {
    emoji: '\uD83D\uDD0C',
    title: 'MCP Integration',
    description:
      'Model Context Protocol server mode lets Claude Desktop and other AI clients analyze heap dumps programmatically.',
  },
  {
    emoji: '\uD83D\uDCCA',
    title: 'Compare & Timeline',
    description:
      'Diff two heap dumps side-by-side or track memory trends across multiple snapshots with D3.js visualizations.',
  },
];

/* ── Components ───────────────────────────────────────────────────────── */

function HomepageHeader(): ReactNode {
  const {siteConfig} = useDocusaurusContext();
  return (
    <header className="hero--heaplens">
      <div className="container">
        <Heading as="h1" className={styles.heroTitle}>
          {siteConfig.title}
        </Heading>
        <p className={styles.heroSubtitle}>
          AI-Powered Java &amp; Android Heap Dump Analyzer for VS Code
        </p>
        <div className={styles.buttons}>
          <Link
            className="button button--primary button--lg"
            to="/docs/getting-started/installation">
            Get Started
          </Link>
          <Link
            className="button button--outline button--lg"
            to="/docs/concepts/heap-dump-fundamentals"
            style={{color: '#fff', borderColor: 'rgba(255,255,255,0.5)'}}>
            How It Works
          </Link>
        </div>
      </div>
    </header>
  );
}

function StatsSection(): ReactNode {
  return (
    <section className={styles.statsSection}>
      {stats.map((s, i) => (
        <div key={i} className={styles.statItem}>
          <div className={styles.statNumber}>{s.number}</div>
          <div className={styles.statLabel}>{s.label}</div>
        </div>
      ))}
    </section>
  );
}

function FeaturesSection(): ReactNode {
  return (
    <section className={styles.featuresSection}>
      <div className="container">
        <Heading as="h2" className={styles.sectionTitle}>
          Why HeapLens?
        </Heading>
        <div className={styles.featureGrid}>
          {features.map((f, i) => (
            <div key={i} className={styles.featureCard}>
              <span className={styles.featureEmoji}>{f.emoji}</span>
              <Heading as="h3">{f.title}</Heading>
              <p>{f.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ── Page ──────────────────────────────────────────────────────────────── */

export default function Home(): ReactNode {
  return (
    <Layout
      title="AI-Powered Java Heap Dump Analyzer"
      description="HeapLens is a VS Code extension with a Rust backend for analyzing Java heap dumps. Features automatic leak detection, waste analysis, dominator tree exploration, and AI-powered insights.">
      <HomepageHeader />
      <main>
        <StatsSection />
        <FeaturesSection />
      </main>
    </Layout>
  );
}
