Explicitly save an insight, decision, preference, or fact to persistent agentmemory.

## Usage

```text
/remember [what to remember]
```

## Instructions

1. Extract the durable fact or lesson from the user's text.
2. Choose 2-5 searchable concepts.
3. Call `agentmemory_memory_save` with `content`, `concepts`, and an appropriate `type` such as `fact`, `preference`, `workflow`, `architecture`, `bug`, or `pattern`.
4. Confirm the memory was saved and show the concepts used.
