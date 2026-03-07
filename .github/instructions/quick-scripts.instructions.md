---
description: Instructions for implementing quick scripts
applyTo: '**/quickscripts/**'
---

# Quick scripts instructions

- MUST use bun runtime
- MUST be written in TypeScript
- MUST be placed in `quickscripts/src`

These are simple hacky scripts that interact with the game via the KROC game mod HTTP server

The [kroc-spec.yml](../../kroc-spec.yml) file at the project root defines the OpenAPI spec API endpoints exposed by the mod. Use these to read game state and send commands.

