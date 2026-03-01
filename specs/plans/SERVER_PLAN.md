# Server Implementation Plan

Derived from [../rfcs/SERVER_RFC.md](../rfcs/SERVER_RFC.md).

**Scope:** Get the ASP.NET Core Kestrel server running inside the mod process with a single proof-of-life endpoint. Game feature endpoints are out of scope and will be planned separately.

Tasks within a phase may be parallelised; tasks in a later phase depend on all prior phases being complete.

---

## Phase 1 — Project Setup

### Task 1.1 — Add ASP.NET Core framework reference to `server.csproj`

**File:** `server/server.csproj`

The project uses `Sdk="Microsoft.NET.Sdk"` (not `Microsoft.NET.Sdk.Web`), so the ASP.NET Core shared framework is not automatically available. Add a `FrameworkReference` (not a `PackageReference`) to make Kestrel and Minimal API types available at compile time:

```xml
<ItemGroup>
  <FrameworkReference Include="Microsoft.AspNetCore.App" />
</ItemGroup>
```

**Acceptance:** `dotnet build server/server.csproj` succeeds and `Microsoft.AspNetCore.Builder.WebApplication` is resolvable in `server/` source files.

---

### Task 1.2 — Create `KrocServerConfig`

**File:** `server/KrocServerConfig.cs`  
**Namespace:** `KROC.Server`

A plain data class passed into `KrocServer` at construction time. Populated from `kroc.toml` using Tomlyn, which is already a dependency of `core`.

```csharp
namespace KROC.Server;

public sealed class KrocServerConfig
{
    /// <summary>Hostname or IP to bind to. Default: "0.0.0.0".</summary>
    public string BindHost { get; init; } = "0.0.0.0";

    /// <summary>Port to listen on. Default: 7887.</summary>
    public int Port { get; init; } = 7887;

    /// <summary>When false the server is not started. Default: true.</summary>
    public bool Enabled { get; init; } = true;
}
```

Add a static factory method `KrocServerConfig.LoadFromToml(string tomlPath)`:
1. If the file does **not** exist, call `WriteDefaultToml(tomlPath)` (see below) to create it, then return a default instance.
2. Reads the file with `Tomlyn.Toml.Parse`.
3. Reads `server_bind_host` (string), `server_port` (int), `server_enabled` (bool) from the top-level table, falling back to defaults for any missing keys.
4. Throws a descriptive `InvalidOperationException` if the file exists but is malformed.

Add a private static helper `WriteDefaultToml(string tomlPath)` that:
1. Creates the directory if it does not exist (`Directory.CreateDirectory`).
2. Writes the following content verbatim to the file:
   ```toml
   # kitten remote operations control — server config
   server_bind_host = "0.0.0.0"
   server_port = 7887
   server_enabled = true
   ```
3. Logs to `Console` that a default config was written and where.

**Acceptance:** When no `kroc.toml` exists, `LoadFromToml` creates one with defaults and returns a config with `BindHost = "0.0.0.0"` and `Port = 7887`. When the file already exists its values are read correctly.

---

## Phase 2 — Core Server Abstractions

### Task 2.1 — Define `IEndpointModule`

**File:** `server/IEndpointModule.cs`  
**Namespace:** `KROC.Server`

```csharp
using Microsoft.AspNetCore.Routing;

namespace KROC.Server;

/// <summary>
/// Implemented by feature projects to register Minimal API routes.
/// Called once during server startup before app.StartAsync().
/// </summary>
public interface IEndpointModule
{
    void Register(IEndpointRouteBuilder routes);
}
```

Feature modules receive `IEndpointRouteBuilder` — the standard ASP.NET Core abstraction implemented by `WebApplication` — and call `MapGet`/`MapPost`/etc. directly on it.

**Acceptance:** Interface compiles. A class implementing it in another project that only references `KROC.Server` compiles without needing a direct ASP.NET Core reference.

---

## Phase 3 — `KrocServer` Host

### Task 3.1 — Implement `KrocServer`

**File:** `server/KrocServer.cs`  
**Namespace:** `KROC.Server`

`KrocServer` owns the `WebApplication` instance. It is the only type the mod project needs to interact with.

**Constructor:**
```csharp
public KrocServer(KrocServerConfig config, IReadOnlyList<IEndpointModule> modules)
```

**Public surface:**
```csharp
public Task StartAsync(CancellationToken ct = default);
public Task StopAsync(CancellationToken ct = default);
```

**`StartAsync` steps:**
1. If `config.Enabled == false`, log to `Console` and return immediately.
2. `var builder = WebApplication.CreateSlimBuilder()` — do **not** use `CreateBuilder()`.
3. `builder.WebHost.UseUrls($"http://{config.BindHost}:{config.Port}")`.
4. Configure JSON options:
   ```csharp
   builder.Services.ConfigureHttpJsonOptions(opts =>
   {
       opts.SerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.CamelCase;
       opts.SerializerOptions.DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull;
   });
   ```
5. `var app = builder.Build()`.
6. Add inline CORS middleware via `app.Use(...)` — write `Access-Control-Allow-Origin: *`, `Access-Control-Allow-Headers: *`, `Access-Control-Allow-Methods: *` on every response; short-circuit `OPTIONS` requests with `200`.
7. Add inline exception middleware via `app.Use(...)` — catch unhandled exceptions from downstream, log to `Console`, and write `{ "error": "<message>" }` with status `500` and `Content-Type: application/json`.
8. Register the `/ping` endpoint (see Task 3.2).
9. Iterate `modules`, calling `module.Register(app)` for each.
10. `await app.StartAsync(ct)`, store `app` for `StopAsync`.

**`StopAsync` steps:**
1. If the app was never started, return immediately.
2. `await app.StopAsync(ct)`.
3. `await app.DisposeAsync()`.
4. Null the stored reference.

**Acceptance:** `StartAsync` runs without throwing; `StopAsync` returns cleanly.

---

### Task 3.2 — Add `/ping` endpoint

Registered directly in `KrocServer.StartAsync` step 8, not in a module:

```csharp
app.MapGet("/ping", () => Results.Ok(new { status = "ok" }));
```

**Acceptance:** `curl http://localhost:6969/ping` returns `{"status":"ok"}` with HTTP 200 while the mod is loaded.

---

## Phase 4 — Mod Integration

### Task 4.1 — Wire `KrocServer` into `Mod.cs`

**File:** `mod/Mod.cs`

1. Add `private KrocServer? _server;` field.
2. In `OnFullyLoaded`, after `Patcher.Patch()`:
   ```csharp
   var config = KrocServerConfig.LoadFromToml(GetConfigPath());
   _server = new KrocServer(config, new List<IEndpointModule>());
   _ = _server.StartAsync();
   ```
   Wrap in try/catch that logs to `Console`.
3. In `Unload`, before setting `_isDisposed`:
   ```csharp
   if (_server != null)
   {
       try { _server.StopAsync().GetAwaiter().GetResult(); }
       catch (Exception ex) { Console.WriteLine($"KROC: error stopping server: {ex.Message}"); }
   }
   ```
4. Add a private helper:
   ```csharp
   private static string GetConfigPath()
   {
       var myDocuments = Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments);
       return Path.Combine(myDocuments, "My Games", "Kitten Space Agency", "kroc.toml");
   }
   ```
   The directory `My Games/Kitten Space Agency` is the standard KSA user-data folder. `KrocServerConfig.LoadFromToml` will create the file (and directory) if absent.

**Acceptance:** Mod loads in-game, `/ping` responds, mod unloads cleanly without errors.

---

### Task 4.2 — Update `mod.csproj` distribution copy targets

**File:** `mod/mod.csproj`

Inside the existing `CopyCustomContent` MSBuild target, add wildcard copy items for the ASP.NET Core assemblies that appear in `$(TargetDir)` as a result of the `FrameworkReference`:

```xml
<ItemGroup>
  <AspNetCoreAssemblies Include="$(TargetDir)Microsoft.AspNetCore.*.dll" />
  <AspNetCoreAssemblies Include="$(TargetDir)Microsoft.Extensions.Hosting*.dll" />
</ItemGroup>
<Copy SourceFiles="@(AspNetCoreAssemblies)"
      DestinationFolder="$(DistDir)"
      Condition="'@(AspNetCoreAssemblies)' != ''" />
```

**Acceptance:** After `dotnet build mod/mod.csproj`, the dist folder contains the Kestrel and ASP.NET Core extension assemblies alongside the mod DLL.

---

## Cross-Cutting Notes

- **No implicit usings:** `ImplicitUsings` is disabled in `Directory.Build.props`. All files need explicit `using` directives.
- **Nullable:** `<Nullable>enable</Nullable>` and `<TreatWarningsAsErrors>true</TreatWarningsAsErrors>` are set globally. All public APIs must be fully annotated.
- **Thread safety:** Kestrel handlers run on the thread pool. Any future handler that touches KSA game state must marshal to the game's main thread. This is not required for `/ping` but is a hard constraint for all subsequent feature endpoint work.

