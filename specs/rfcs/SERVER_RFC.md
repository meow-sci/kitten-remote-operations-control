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

> **Note:** ASP.NET Core / Kestrel cannot be used due to conflicts with how KSA loads game assemblies and manages the host process. **GenHTTP** (`GenHTTP.Core`) is used instead — it is a lightweight, embeddable .NET HTTP server with no dependency on the ASP.NET Core shared framework.

# Features

## Server Infrastructure

- HTTP server implemented using **GenHTTP** (`GenHTTP.Core` NuGet package) running embedded inside the mod process
- Routes are defined using the **GenHTTP Functional Handlers** (`Inline.Create()`) and **Layout** (`Layout.Create()`) APIs, or the **Webservice** framework (`AddService<T>`) for class-based handlers
- Configurable bind address and listener port via `Host.Create().Bind(address, port)`, e.g. `http://0.0.0.0:7887`
- Server is built with `Host.Create()` using the internal (non-Kestrel) engine to minimize overhead and avoid any ASP.NET Core dependency
- Server lifecycle tied to the mod lifecycle: server started (via `host.StartAsync()`) in `OnFullyLoaded`, stopped (via `host.StopAsync()`) in `Unload`
- The `IServerHost` instance is owned by the server project and not exposed directly to feature modules; feature modules receive a `LayoutBuilder` to register their routes
- Handler methods receive injected parameters (query, path, body) and return POCOs (serialized as JSON automatically) or `IResponseBuilder` for custom responses
- Handlers must marshal game state reads back to the game's main thread where required (game APIs are not thread-safe)
- Request and response bodies serialized as JSON using `System.Text.Json` via GenHTTP's built-in serialization; a shared `JsonSerializerOptions` instance (camelCase, ignore nulls) may be configured through the serialization module

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
- CORS headers added to all responses to allow browser-based clients via `CorsPolicy.Permissive()` from `GenHTTP.Modules.Security`

## Real-time Telemetry (Server-Sent Events)

- A `/events` SSE endpoint streams game state updates at a configurable tick rate (default ~10 Hz)
- Implemented using `GenHTTP.Modules.ServerSentEvents` — an `EventSource.Create().Generator(...)` handler registered on the layout
- Clients subscribe by connecting; GenHTTP keeps the connection open for the lifetime of the stream
- Each event carries a named type via `connection.DataAsync(payload, eventType: "telemetry")`, e.g. `telemetry`, `orbit`, `resources`
- The server project provides a broadcaster utility (`SseBroadcaster`) that feature modules push named event payloads into; the broadcaster fans out to all active SSE connections via their `IEventConnection`
- `IEventConnection.Connected` is used to detect client disconnects and remove the connection from the broadcaster
- Clean mod shutdown calls `host.StopAsync()`, which terminates all in-flight SSE connections

