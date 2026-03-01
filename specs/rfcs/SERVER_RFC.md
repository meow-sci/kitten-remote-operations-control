# Overview

Provide a server for remote procedure calls for KSA.

Code will be organized so that implementations that back HTTP endpoints will be built in independent csproj library projects.

The overall project hierarchy will ultimately resemble:

- mod
  - server
  - rpc-feature-1
  - rpc-feature-2

The top-level mod will need to instantiate and start the HTTP server and then register rpc-feature-1, rpc-feature-2 as handlers.

The server project must provide a very simple interface to accomplish this, encapsulating complexity of implementation details inside itself.

# Features

## Server Infrastructure

- HTTP server implemented using **ASP.NET Core Kestrel** (`Microsoft.AspNetCore.Server.Kestrel`) running as a self-hosted `WebApplication` inside the mod process
- Routes are defined using the **ASP.NET Core Minimal API** style (`app.MapGet`, `app.MapPost`, etc.)
- Configurable bind address and listener port via `WebApplication.Urls`, e.g. `http://localhost:6969`
- Server is built with `WebApplication.CreateSlimBuilder()` to minimize overhead and avoid unnecessary middleware
- Server lifecycle tied to the mod lifecycle: `WebApplication` started (via `app.StartAsync()`) in `OnFullyLoaded`, stopped (via `app.StopAsync()`) and disposed in `Unload`
- The `WebApplication` instance, along with its `IServiceProvider`, is owned by the server project and not exposed directly to feature modules
- Handlers receive `HttpContext` and return `IResult` or write directly to `HttpContext.Response`; all async I/O is naturally handled by the Kestrel pipeline
- Handlers must marshal game state reads back to the game's main thread where required (game APIs are not thread-safe)
- Request and response bodies serialized as JSON using the `System.Text.Json` source generator configured on the slim builder; a shared `JsonSerializerOptions` instance (camelCase, ignore nulls) is provided by the server project

## Configuration

- Bind address and port read from a `kroc.toml` config file placed beside the mod in props `server_bind_host` and `server_port`
- Hot-reload of configuration not required; changes take effect on game restart
- A runtime flag to enable/disable the server entirely without unloading the mod

## Response Conventions

- All endpoints return `application/json`
- Successful responses: `200 OK` with a JSON body, or `204 No Content` for commands that produce no data
- Client errors (bad route, missing parameter): `400 Bad Request` or `404 Not Found` with `{ "error": "<message>" }`
- Server/game-side errors: `500 Internal Server Error` with `{ "error": "<message>" }`
- A standard envelope is not required; response shapes are defined per endpoint

## Security

- Bind to `localhost` only by default; exposing to the network is opt-in via config
- No authentication is implemented in v1; operators exposing the port beyond localhost are responsible for their own firewall rules
- CORS headers added to all responses to allow browser-based clients (`Access-Control-Allow-Origin: *`)

## Real-time Telemetry (Server-Sent Events)

- A `/events` SSE endpoint streams game state updates at a configurable tick rate (default ~10 Hz)
- Implemented as a Minimal API endpoint that sets `Content-Type: text/event-stream` and writes `data: ...

` frames directly to `HttpContext.Response.Body`
- Clients subscribe by connecting with `Accept: text/event-stream`; Kestrel keeps the connection open for the lifetime of the stream
- Each event carries a named type written as `event: <name>\ndata: <json>\n\n`, e.g. `telemetry`, `orbit`, `resources`
- The server project provides a broadcaster utility (`SseBroadcaster`) that feature modules push named event payloads into; the broadcaster fans out to all active SSE response streams
- `CancellationToken` from `HttpContext.RequestAborted` is used to detect client disconnects and remove the stream from the broadcaster
- Clean mod shutdown calls `app.StopAsync()`, which cancels all in-flight SSE responses via the host shutdown token

