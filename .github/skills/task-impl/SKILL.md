---
name: task-impl
description: Common task implementation instructions
---

When using the #runSubagent tool to implement a task list, you SHOULD follow these instructions to ensure that your implementation is consistent and effective.

- Use the `#runSubagent` tool to execute each task in the list.
- Run each task sequentially
- Instruct each subagent that after the task is completed, perform a /git-commit using the git-commit skill which covers all the modifications
- Each task should only be considered completed if the project compiles cleanly
