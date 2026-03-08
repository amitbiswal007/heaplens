package com.heaplens.agent;

import javax.management.MBeanServerConnection;
import javax.management.ObjectName;
import javax.management.openmbean.CompositeData;
import javax.management.remote.JMXConnector;
import javax.management.remote.JMXConnectorFactory;
import javax.management.remote.JMXServiceURL;
import java.lang.management.ManagementFactory;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;

/**
 * Collects JVM metrics via JMX MBeans.
 * Supports both local (PID attach) and remote (host:port) connections.
 */
public class JmxCollector {
    private final AgentConfig config;
    private MBeanServerConnection mbeanConn;
    private JMXConnector jmxConnector;

    public JmxCollector(AgentConfig config) {
        this.config = config;
    }

    /**
     * Connects to the target JVM via JMX.
     * For local PID: uses the platform MBean server (agent must run in same JVM or use attach API).
     * For remote: connects via JMXServiceURL.
     */
    public void connect() throws Exception {
        if (config.isLocalAttach()) {
            // For local PID, try to connect via JMX service URL on localhost
            // The target JVM must have JMX enabled
            String url = "service:jmx:rmi:///jndi/rmi://localhost:" + config.getJmxPort() + "/jmxrmi";
            if (config.getJmxPort() > 0) {
                JMXServiceURL serviceUrl = new JMXServiceURL(url);
                jmxConnector = JMXConnectorFactory.connect(serviceUrl);
                mbeanConn = jmxConnector.getMBeanServerConnection();
            } else {
                // Fallback: use platform MBean server (only works if running in same JVM)
                mbeanConn = ManagementFactory.getPlatformMBeanServer();
            }
        } else {
            String url = "service:jmx:rmi:///jndi/rmi://"
                    + config.getJmxHost() + ":" + config.getJmxPort() + "/jmxrmi";
            JMXServiceURL serviceUrl = new JMXServiceURL(url);
            jmxConnector = JMXConnectorFactory.connect(serviceUrl);
            mbeanConn = jmxConnector.getMBeanServerConnection();
        }
        System.err.println("[heaplens-agent] JMX connection established");
    }

    /**
     * Collects current JVM metrics. ~0ms overhead (reads MBean counters).
     */
    public JvmMetrics collectMetrics() throws Exception {
        JvmMetrics m = new JvmMetrics();
        m.timestamp = System.currentTimeMillis();

        // Memory
        ObjectName memoryBean = new ObjectName("java.lang:type=Memory");
        CompositeData heapUsage = (CompositeData) mbeanConn.getAttribute(memoryBean, "HeapMemoryUsage");
        m.heapUsed = (Long) heapUsage.get("used");
        m.heapMax = (Long) heapUsage.get("max");
        m.heapCommitted = (Long) heapUsage.get("committed");

        CompositeData nonHeapUsage = (CompositeData) mbeanConn.getAttribute(memoryBean, "NonHeapMemoryUsage");
        m.nonHeapUsed = (Long) nonHeapUsage.get("used");
        m.nonHeapCommitted = (Long) nonHeapUsage.get("committed");

        // Threads
        ObjectName threadBean = new ObjectName("java.lang:type=Threading");
        m.threadCount = (Integer) mbeanConn.getAttribute(threadBean, "ThreadCount");
        m.daemonThreadCount = (Integer) mbeanConn.getAttribute(threadBean, "DaemonThreadCount");

        // Runtime (uptime)
        ObjectName runtimeBean = new ObjectName("java.lang:type=Runtime");
        m.uptime = (Long) mbeanConn.getAttribute(runtimeBean, "Uptime");

        // GC collectors
        m.gcCollectors = new ArrayList<>();
        Set<ObjectName> gcBeans = mbeanConn.queryNames(
                new ObjectName("java.lang:type=GarbageCollector,*"), null);
        for (ObjectName gc : gcBeans) {
            String name = (String) mbeanConn.getAttribute(gc, "Name");
            long count = (Long) mbeanConn.getAttribute(gc, "CollectionCount");
            long timeMs = (Long) mbeanConn.getAttribute(gc, "CollectionTime");
            m.gcCollectors.add(new JvmMetrics.GcCollectorInfo(name, count, timeMs));
        }

        // Memory pools
        m.memoryPools = new ArrayList<>();
        Set<ObjectName> poolBeans = mbeanConn.queryNames(
                new ObjectName("java.lang:type=MemoryPool,*"), null);
        for (ObjectName pool : poolBeans) {
            String name = (String) mbeanConn.getAttribute(pool, "Name");
            String type = mbeanConn.getAttribute(pool, "Type").toString();
            CompositeData usage = (CompositeData) mbeanConn.getAttribute(pool, "Usage");
            long used = (Long) usage.get("used");
            long max = (Long) usage.get("max");
            long committed = (Long) usage.get("committed");
            m.memoryPools.add(new JvmMetrics.MemoryPoolInfo(name, type, used, max, committed));
        }

        return m;
    }

    /**
     * Collects a class histogram via DiagnosticCommandMXBean.
     * Moderate cost — use on-demand only.
     */
    public List<ClassHistogramEntry> collectClassHistogram() {
        List<ClassHistogramEntry> entries = new ArrayList<>();
        try {
            ObjectName diagBean = new ObjectName("com.sun.management:type=DiagnosticCommand");
            String[] emptyArgs = new String[0];
            String result = (String) mbeanConn.invoke(diagBean, "gcClassHistogram",
                    new Object[]{emptyArgs}, new String[]{"[Ljava.lang.String;"});

            // Parse the tabular output:
            //  num     #instances         #bytes  class name
            //    1:        12345        6789012  java.lang.String
            String[] lines = result.split("\n");
            for (String line : lines) {
                line = line.trim();
                if (line.isEmpty() || line.startsWith("num") || line.startsWith("Total") || line.startsWith("---")) {
                    continue;
                }
                // Format: "N:  count  bytes  className"
                int colonIdx = line.indexOf(':');
                if (colonIdx < 0) continue;

                String rest = line.substring(colonIdx + 1).trim();
                String[] parts = rest.split("\\s+");
                if (parts.length >= 3) {
                    try {
                        long count = Long.parseLong(parts[0]);
                        long bytes = Long.parseLong(parts[1]);
                        String className = parts[2];
                        entries.add(new ClassHistogramEntry(className, count, bytes));
                    } catch (NumberFormatException e) {
                        // Skip unparseable lines
                    }
                }
            }
        } catch (Exception e) {
            System.err.println("[heaplens-agent] Class histogram collection failed: " + e.getMessage());
        }

        return entries;
    }

    /**
     * Closes the JMX connection.
     */
    public void close() {
        if (jmxConnector != null) {
            try {
                jmxConnector.close();
            } catch (Exception e) {
                // ignore
            }
        }
    }
}
