Search persistent agentmemory for relevant past context.

## Usage

```text
/recall [query]
```

## Instructions

1. Call `agentmemory_memory_smart_search` with the query and `limit: 10`.
2. If lessons may be relevant, also call `agentmemory_memory_lesson_recall` with `limit: 5`.
3. Present only returned results. Group by session or memory type when useful.
4. If nothing is found, say so and suggest more specific search terms.
