---
sidebar_position: 3
title: Generating Heap Dumps
---

# Generating Heap Dumps

HeapLens analyzes Java heap dumps in HPROF binary format. This page covers the most common ways to capture one.

## From a Running JVM

### jmap (JDK tool)

```bash
# Find your Java process ID
jps -l

# Capture a heap dump
jmap -dump:format=b,file=heap.hprof <pid>
```

`jmap` pauses the JVM while dumping — use with care in production.

### jcmd (preferred for JDK 9+)

```bash
jcmd <pid> GC.heap_dump /tmp/heap.hprof
```

### JVM flag (on OutOfMemoryError)

Add this to your application's JVM arguments to capture a heap dump automatically when the JVM runs out of memory:

```bash
java -XX:+HeapDumpOnOutOfMemoryError \
     -XX:HeapDumpPath=/tmp/heapdump.hprof \
     -jar myapp.jar
```

This is the most common way production heap dumps are captured — the dump is created at the exact moment memory pressure peaks.

## From Application Frameworks

### Spring Boot Actuator

If your Spring Boot application has Actuator enabled:

```bash
curl -X POST http://localhost:8080/actuator/heapdump -o heap.hprof
```

### Kubernetes / Docker

```bash
# Find the PID inside the container (usually 1)
kubectl exec -it <pod> -- jcmd 1 GC.heap_dump /tmp/heap.hprof

# Copy the dump to your local machine
kubectl cp <pod>:/tmp/heap.hprof ./heap.hprof
```

## Generating a Test Dump

If you need a heap dump for testing HeapLens, create a simple Java program:

```java
import java.util.*;

public class LeakyApp {
    static List<byte[]> leak = new ArrayList<>();

    public static void main(String[] args) throws Exception {
        // Allocate ~100 MB in 1 MB chunks
        for (int i = 0; i < 100; i++) {
            leak.add(new byte[1024 * 1024]);
        }

        // Keep running so you can take a dump
        System.out.println("PID: " + ProcessHandle.current().pid());
        System.out.println("Press Enter to exit...");
        System.in.read();
    }
}
```

```bash
javac LeakyApp.java
java -Xmx256m LeakyApp &
jmap -dump:format=b,file=test.hprof $(jps -l | grep LeakyApp | awk '{print $1}')
```

## HPROF Format Reference

The HPROF binary format consists of:

| Section | Content |
|---------|---------|
| Header | Magic string `JAVA PROFILE 1.0.2\0`, ID size (4 or 8 bytes), timestamp |
| Records | Sequential records: UTF8 strings, LoadClass, HeapDump segments |
| Heap Dump | Sub-records: GC roots, class definitions, instance dumps, array dumps |

HeapLens reads this format using the `jvm-hprof` Rust crate with zero-copy memory-mapped I/O — the file is never loaded entirely into RAM.

## File Size Guidelines

| Application Type | Typical Dump Size |
|-----------------|-------------------|
| Microservice (256 MB heap) | 50-200 MB |
| Monolith (2 GB heap) | 500 MB - 2 GB |
| Data-intensive (8 GB heap) | 2-8 GB |

HeapLens handles multi-GB files efficiently through memory mapping. The analysis server's RAM usage is typically 2-3x the dump file size during graph construction.
