package com.heaplens.agent;

/**
 * Entry point for the HeapLens JVM monitoring agent.
 *
 * Usage:
 *   java -jar heaplens-agent.jar --jmx-host localhost --jmx-port 9010 [--listen-port 9095]
 *   java -jar heaplens-agent.jar --pid 12345 --jmx-port 9010 [--listen-port 9095]
 */
public class AgentMain {

    public static void main(String[] args) {
        System.err.println("[heaplens-agent] Starting HeapLens JVM Agent v0.1.0");

        AgentConfig config = AgentConfig.parse(args);
        String validationError = config.validate();
        if (validationError != null) {
            System.err.println("[heaplens-agent] Configuration error: " + validationError);
            System.err.println("Usage: java -jar heaplens-agent.jar --jmx-host HOST --jmx-port PORT [--listen-port PORT]");
            System.err.println("   or: java -jar heaplens-agent.jar --pid PID --jmx-port PORT [--listen-port PORT]");
            System.exit(1);
        }

        JmxCollector collector = new JmxCollector(config);
        try {
            collector.connect();
        } catch (Exception e) {
            System.err.println("[heaplens-agent] Failed to connect to JVM: " + e.getMessage());
            System.exit(1);
        }

        MetricsServer server = new MetricsServer(
                config.getListenPort(),
                collector,
                config.getIdleTimeoutSeconds()
        );

        // Shutdown hook for graceful cleanup
        Runtime.getRuntime().addShutdownHook(new Thread(() -> {
            System.err.println("[heaplens-agent] Shutting down...");
            server.stop();
            collector.close();
        }));

        try {
            server.start();
        } catch (Exception e) {
            System.err.println("[heaplens-agent] Server error: " + e.getMessage());
            collector.close();
            System.exit(1);
        }
    }
}
