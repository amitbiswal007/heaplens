---
sidebar_position: 5
title: Waste Tab
---

# Waste Tab

The Waste tab identifies memory consumed by redundant or unnecessary objects — memory that can typically be recovered without changing application logic. This is complementary to leak detection: leaks are objects that should not exist; waste is objects that exist but are inefficiently stored.

## What You See

### Summary Bar

Four stat cards across the top:

```
┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│ Total Waste  │ │ % of Heap    │ │ Dup Strings  │ │ Empty Colls  │
│   45.20 MB   │ │    8.8%      │ │   35.60 MB   │ │    9.60 MB   │
└──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘
```

| Card | Meaning |
|------|---------|
| **Total Waste** | Combined bytes wasted by duplicate strings and empty collections |
| **% of Heap** | Waste as a percentage of total heap size |
| **Dup Strings** | Bytes wasted by duplicate `java.lang.String` instances |
| **Empty Colls** | Bytes wasted by empty `HashMap`, `ArrayList`, `LinkedHashMap` instances |

### Duplicate Strings Table

```
Preview                                         Copies    Wasted
"application/json"                              8,200     820 KB
"UTF-8"                                         6,100     390 KB
"true"                                          14,500    580 KB
"SELECT * FROM users WHERE id = ?"              2,300     230 KB
""                                              45,000    1.80 MB
"https://api.example.com/v2/data"               1,800     198 KB
```

| Column | Description |
|--------|-------------|
| **Preview** | First 60 characters of the string content |
| **Copies** | How many separate `String` instances have identical content |
| **Wasted** | Bytes wasted: `(copies - 1) × single_instance_size` |

### Empty Collections Table

```
Class                              Count      Wasted
java.util.HashMap                  120,000    5.70 MB
java.util.ArrayList                85,000     3.40 MB
java.util.LinkedHashMap            12,000     672 KB
```

| Column | Description |
|--------|-------------|
| **Class** | The collection class |
| **Count** | Number of instances with `size == 0` |
| **Wasted** | Total shallow size of all empty instances |

## How to Interpret the Results

### High Duplicate String Waste

If duplicate strings account for more than 5% of the heap, consider:

1. **`-XX:+UseStringDeduplication`** — Zero-code-change fix for G1 GC (JDK 8u20+). The GC identifies and deduplicates strings during collection.

2. **Application-level interning** — For known high-frequency values:
   ```java
   // Before: each deserialized JSON creates a new String
   String contentType = response.getHeader("Content-Type");

   // After: shared constant
   private static final String JSON_TYPE = "application/json";
   String contentType = response.getHeader("Content-Type");
   if (JSON_TYPE.equals(contentType)) contentType = JSON_TYPE;
   ```

3. **Enum replacement** — If a string has a small set of known values (`"ACTIVE"`, `"INACTIVE"`, `"PENDING"`), replace with an enum.

### Common Duplicate Strings

| String Pattern | Typical Source | Fix |
|---------------|---------------|-----|
| `""` (empty) | Default values, optional fields | Use `null` or a shared constant |
| `"true"` / `"false"` | Serialization, config parsing | Parse to boolean |
| HTTP headers | Repeated per request | Constant pool |
| SQL queries | ORM-generated queries | Statement caching |
| Class names, package paths | Reflection, logging | Interning |

### High Empty Collection Waste

120,000 empty HashMaps at 48-112 bytes each = 5.7 MB. This usually comes from:

- **Defensive allocation** — Objects create `new HashMap<>()` in constructors even when the map is rarely populated
- **Deserialization** — JSON/XML deserializers create empty collections for absent fields
- **Builder pattern** — Builders that allocate all internal collections upfront

**Fix:** Lazy initialization:

```java
// Before
class UserProfile {
    Map<String, String> preferences = new HashMap<>();
    List<Address> addresses = new ArrayList<>();
}

// After
class UserProfile {
    Map<String, String> preferences;  // null until first use
    List<Address> addresses;

    void addPreference(String key, String value) {
        if (preferences == null) preferences = new HashMap<>(4);
        preferences.put(key, value);
    }
}
```

## Example Walkthrough

**Scenario:** A REST API service uses 800 MB heap. The Overview tab shows no obvious leak. The Waste tab reveals:

```
Total Waste: 142 MB (17.7%)
├─ Duplicate Strings: 98 MB
└─ Empty Collections: 44 MB
```

**Duplicate strings (top entries):**

| Preview | Copies | Wasted |
|---------|--------|--------|
| `"Bearer "` | 450,000 | 18 MB |
| `"application/json"` | 380,000 | 16 MB |
| `"200"` | 320,000 | 8 MB |

**Diagnosis:** The service handles 500K requests/minute and creates new `String` instances for HTTP header values per request. These strings are identical but not shared.

**Fix:** Add `-XX:+UseStringDeduplication` to JVM flags (immediate, no code changes). For a permanent fix, use a constant pool for known header values.

**Empty collections:**

| Class | Count | Wasted |
|-------|-------|--------|
| `HashMap` | 450,000 | 21 MB |
| `ArrayList` | 380,000 | 15 MB |

**Diagnosis:** Each request DTO has `Map<String, Object> metadata` initialized eagerly but populated in only 5% of requests.

**Fix:** Change the field to `null` default with lazy initialization. Estimated savings: ~35 MB (most of the 450K empty HashMaps are from DTOs).

**Total recoverable:** ~142 MB (17.7% of heap) with two changes — JVM flag and lazy init.
