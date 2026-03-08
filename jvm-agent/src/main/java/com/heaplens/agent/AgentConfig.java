package com.heaplens.agent;

/**
 * Configuration for the HeapLens JVM monitoring agent.
 * Parsed from CLI arguments.
 */
public class AgentConfig {
    private String jmxHost = "localhost";
    private int jmxPort = -1;
    private int listenPort = 9095;
    private int pid = -1;
    private int idleTimeoutSeconds = 60;

    public String getJmxHost() { return jmxHost; }
    public int getJmxPort() { return jmxPort; }
    public int getListenPort() { return listenPort; }
    public int getPid() { return pid; }
    public int getIdleTimeoutSeconds() { return idleTimeoutSeconds; }

    /**
     * Parses CLI arguments into an AgentConfig.
     * Supported flags:
     *   --jmx-host HOST
     *   --jmx-port PORT
     *   --listen-port PORT
     *   --pid PID
     *   --idle-timeout SECONDS
     */
    public static AgentConfig parse(String[] args) {
        AgentConfig config = new AgentConfig();
        for (int i = 0; i < args.length; i++) {
            switch (args[i]) {
                case "--jmx-host":
                    if (i + 1 < args.length) config.jmxHost = args[++i];
                    break;
                case "--jmx-port":
                    if (i + 1 < args.length) config.jmxPort = Integer.parseInt(args[++i]);
                    break;
                case "--listen-port":
                    if (i + 1 < args.length) config.listenPort = Integer.parseInt(args[++i]);
                    break;
                case "--pid":
                    if (i + 1 < args.length) config.pid = Integer.parseInt(args[++i]);
                    break;
                case "--idle-timeout":
                    if (i + 1 < args.length) config.idleTimeoutSeconds = Integer.parseInt(args[++i]);
                    break;
                default:
                    System.err.println("Unknown argument: " + args[i]);
                    break;
            }
        }
        return config;
    }

    /**
     * Validates the configuration. Returns an error message or null if valid.
     */
    public String validate() {
        if (pid < 0 && jmxPort < 0) {
            return "Either --pid or --jmx-port must be specified";
        }
        if (listenPort < 1 || listenPort > 65535) {
            return "Invalid listen port: " + listenPort;
        }
        if (jmxPort > 0 && (jmxPort < 1 || jmxPort > 65535)) {
            return "Invalid JMX port: " + jmxPort;
        }
        return null;
    }

    public boolean isLocalAttach() {
        return pid > 0;
    }
}
