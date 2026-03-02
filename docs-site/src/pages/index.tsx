import type {ReactNode} from 'react';
import clsx from 'clsx';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import Layout from '@theme/Layout';
import Heading from '@theme/Heading';

import styles from './index.module.css';

function HomepageHeader() {
  const {siteConfig} = useDocusaurusContext();
  return (
    <header className={clsx('hero hero--primary', styles.heroBanner)}>
      <div className="container">
        <Heading as="h1" className="hero__title">
          {siteConfig.title}
        </Heading>
        <p className="hero__subtitle">{siteConfig.tagline}</p>
        <div className={styles.buttons}>
          <Link
            className="button button--secondary button--lg"
            to="/docs/getting-started/installation">
            Get Started
          </Link>
          <Link
            className="button button--outline button--secondary button--lg"
            to="/docs/concepts/heap-dump-fundamentals"
            style={{marginLeft: '1rem'}}>
            Learn the Concepts
          </Link>
        </div>
      </div>
    </header>
  );
}

function Feature({title, description}: {title: string; description: string}) {
  return (
    <div className={clsx('col col--4')}>
      <div className="text--center padding-horiz--md padding-vert--lg">
        <Heading as="h3">{title}</Heading>
        <p>{description}</p>
      </div>
    </div>
  );
}

const features = [
  {
    title: 'High-Performance Rust Engine',
    description: 'Parses HPROF files with zero-copy memory mapping. Computes dominator trees, retained sizes, and leak suspects in seconds, even for multi-GB heap dumps.',
  },
  {
    title: 'Interactive 7-Tab Analysis',
    description: 'Overview stats, class histogram, expandable dominator tree, automatic leak detection, waste analysis, source code bridging, and AI-powered chat — all in one view.',
  },
  {
    title: 'AI-Native & MCP Ready',
    description: 'Built-in LLM chat for natural-language heap analysis. MCP server mode lets Claude Desktop and other AI clients analyze heap dumps directly.',
  },
];

export default function Home(): ReactNode {
  const {siteConfig} = useDocusaurusContext();
  return (
    <Layout
      title="LLM-Powered Java Heap Dump Analyzer"
      description="HeapLens is a VS Code extension with a Rust backend for analyzing Java heap dumps. Features automatic leak detection, waste analysis, dominator tree exploration, and AI-powered insights.">
      <HomepageHeader />
      <main>
        <section className="padding-vert--xl">
          <div className="container">
            <div className="row">
              {features.map((props, idx) => (
                <Feature key={idx} {...props} />
              ))}
            </div>
          </div>
        </section>
      </main>
    </Layout>
  );
}
