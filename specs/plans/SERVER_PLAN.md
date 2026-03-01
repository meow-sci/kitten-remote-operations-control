# Server Implementation Plan

Derived from [../rfcs/SERVER_RFC.md](../rfcs/SERVER_RFC.md).

**Scope:** Get the GenHTTP server running embedded inside the mod process with a single proof-of-life endpoint. Game feature endpoints are out of scope and will be planned separately.

> ASP.NET Core / Kestrel cannot be used due to conflicts with KSA game assembly loading. GenHTTP (`GenHTTP.Core`) is used instead — a lightweight, embeddable .NET HTTP server with no ASP.NET Core dependency.

Tasks within a phase may be parallelised; tasks in a later phase depend on all prior phases being complete.

---

## Phase 1 — Project Setup

### Task 1.1 — Add GenHTTP NuGet packages to `server.csproj`

**File:** `server/server.csproj`

Remove any `FrameworkReference` to `Microsoft.AspNetCore.App`. Add `PackageReference` entries for GenHTTP:

```xml
<ItemGroup>
  <PackageReference Include="GenHTTP.Core" Version="10.5.0" />
  <PackageReference Include="GenHTTP.Modules.Functional" Version="10.5.0" />
  <PackageReference Include="GenHTTP.Modules.Layouting" Version="10.5.0" />
  <PackageReference Include="GenHTTP.Modules.Practices" Version="10.5.0" />
  <PackageReference Include="GenHTTP.Modules.Security" Version="10.5.0" />
  <PackageReference Include="GenHTTP.Modules.ErrorHandling" Version="10.5.0" />
</ItemGroup>
```

**Acceptance:** `dotnet build server/server.csproj` succeeds and `GenHTTP.Engine.Internal.Host` is resolvable in `server/` source files.

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
using GenHTTP.Modules.Layouting;

namespace KROC.Server;

/// <summary>
/// Implemented by feature projects to register routes on a GenHTTP layout.
/// Called once during server startup before host.StartAsync().
/// </summary>
public interface IEndpointModule
{
    void Register(LayoutBuilder routes);
}
```

Feature modules receive a `LayoutBuilder` — GenHTTP's routing container — and call `.Add("path", handler)` or use `Inline.Create()` / `AddService<T>()` to register their handlers.

**Acceptance:** Interface compiles. A class implementing it in another project that only references `KROC.Server` compiles without needing additional GenHTTP packages (the transitive dependency from `server.csproj` provides them).

---

## Phase 3 — `KrocServer` Host

### Task 3.1 — Implement `KrocServer`

**File:** `server/KrocServer.cs`  
**Namespace:** `KROC.Server`

`KrocServer` owns the `IServerHost` instance. It is the only type the mod project needs to interact with.

**Constructor:**
```csharp
public KrocServer(KrocServerConfig config, IReadOnlyList<IEndpointModule> modules)
```

**Public surface:**
```csharp
public Task StartAsync();
public Task StopAsync();
```

**`StartAsync` steps:**
1. If `config.Enabled == false`, log to `Console` and return immediately.
2. Build the root handler layout:
   ```csharp
   var api = Layout.Create();
   ```
3. Register the `/ping` endpoint inline (see Task 3.2).
4. Add CORS support:
   ```csharp
   api.Add(CorsPolicy.Permissive());
   ```
5. Add custom error handling concern for JSON error responses:
   ```csharp
   api.Add(ErrorHandler.From(new JsonErrorMapper()));
   ```
6. Iterate `modules`, calling `module.Register(api)` for each.
7. Build and start the server:
   ```csharp
   var host = await Host.Create()
       .Handler(api)
       .Bind(IPAddress.Parse(config.BindHost), (ushort)config.Port)
       .Defaults()
       .StartAsync();
   ```
8. Store `host` for `StopAsync`.

**`StopAsync` steps:**
1. If the host was never started, return immediately.
2. `await _host.StopAsync()`.
3. Null the stored reference.

**`JsonErrorMapper`** — a private nested class implementing `IErrorMapper<Exception>`:
- `GetNotFound` returns a JSON response `{ "error": "not found" }` with status 404.
- `Map` logs the exception to `Console` and returns `{ "error": "<message>" }` with status 500.

**Acceptance:** `StartAsync` runs without throwing; `StopAsync` returns cleanly.

---

### Task 3.2 — Add `/ping` endpoint

Registered directly in `KrocServer.StartAsync` step 3 via `Inline`:

```csharp
var ping = Inline.Create()
                 .Get(() => new { status = "ok" });

api.Add("ping", ping);
```

**Acceptance:** `curl http://localhost:7887/ping` returns `{"status":"ok"}` with HTTP 200 while the mod is loaded.

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

1. **Remove** the `FrameworkReference` to `Microsoft.AspNetCore.App`.
2. **Remove** the wildcard copy items for `Microsoft.AspNetCore.*.dll` and `Microsoft.Extensions.Hosting*.dll`.
3. **Add** wildcard copy items for GenHTTP assemblies that appear in `$(TargetDir)`:

```xml
<ItemGroup>
  <GenHttpAssemblies Include="$(TargetDir)GenHTTP.*.dll" />
</ItemGroup>
<Copy SourceFiles="@(GenHttpAssemblies)"
      DestinationFolder="$(DistDir)"
      Condition="'@(GenHttpAssemblies)' != ''" />
```

**Acceptance:** After `dotnet build mod/mod.csproj`, the dist folder contains the GenHTTP assemblies alongside the mod DLL. No `Microsoft.AspNetCore.*` assemblies are present.

---

## Cross-Cutting Notes

- **No implicit usings:** `ImplicitUsings` is disabled in `Directory.Build.props`. All files need explicit `using` directives.
- **Nullable:** `<Nullable>enable</Nullable>` and `<TreatWarningsAsErrors>true</TreatWarningsAsErrors>` are set globally. All public APIs must be fully annotated.
- **Thread safety:** GenHTTP handlers run on the thread pool. Any future handler that touches KSA game state must marshal to the game's main thread. This is not required for `/ping` but is a hard constraint for all subsequent feature endpoint work.
- **No ASP.NET Core dependency:** Neither the `server` project nor any feature module project should reference `Microsoft.AspNetCore.App`. All HTTP concerns are handled by GenHTTP packages.

