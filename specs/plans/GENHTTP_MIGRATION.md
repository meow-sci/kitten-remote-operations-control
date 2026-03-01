# GenHTTP Migration Tasks

Migrate the existing KROC server infrastructure from ASP.NET Core / Kestrel to GenHTTP.

The project already has partial GenHTTP references in some csproj files but the C# source code still uses ASP.NET Core types throughout. This plan converts every file that needs to change.

All tasks are independent within a phase. Later phases depend on earlier ones.

---

## Phase 1 — Project References

### Task 1.1 — Update `server/server.csproj`

**Current state:** Has a commented-out `FrameworkReference` for ASP.NET Core and a `PackageReference` for `GenHTTP.Core 10.5.0`, but is missing the additional GenHTTP module packages the server code needs.

**Changes:**
1. Ensure the ASP.NET Core `FrameworkReference` line is fully removed (not just commented).
2. Add the following `PackageReference` entries alongside the existing `GenHTTP.Core`:

```xml
<PackageReference Include="GenHTTP.Modules.Functional" Version="10.5.0" />
<PackageReference Include="GenHTTP.Modules.Layouting" Version="10.5.0" />
<PackageReference Include="GenHTTP.Modules.Practices" Version="10.5.0" />
<PackageReference Include="GenHTTP.Modules.Security" Version="10.5.0" />
<PackageReference Include="GenHTTP.Modules.ErrorHandling" Version="10.5.0" />
```

**Acceptance:** `dotnet restore server/server.csproj` succeeds with no warnings.

---

### Task 1.2 — Update `feat-ping/feat-ping.csproj`

**Current state:** Has a `PackageReference` for `GenHTTP.Core 10.5.0` that is not needed — the transitive dependency from `server.csproj` suffices.

**Changes:**
1. Remove the standalone `GenHTTP.Core` package reference. The project only needs a `ProjectReference` to `server`.

**Acceptance:** `dotnet restore feat-ping/feat-ping.csproj` succeeds.

---

### Task 1.3 — Update `mod/mod.csproj`

**Current state:** Has `<FrameworkReference Include="Microsoft.AspNetCore.App" />` and wildcard copy targets for `Microsoft.AspNetCore.*.dll` / `Microsoft.Extensions.Hosting*.dll`.

**Changes:**
1. Remove the `<FrameworkReference Include="Microsoft.AspNetCore.App" />` line.
2. In the `CopyCustomContent` target, remove the `<AspNetCoreAssemblies>` ItemGroup and its `<Copy>` element.
3. Add a new ItemGroup + Copy for GenHTTP assemblies:

```xml
<ItemGroup>
  <GenHttpAssemblies Include="$(TargetDir)GenHTTP.*.dll" />
</ItemGroup>
<Copy SourceFiles="@(GenHttpAssemblies)"
      DestinationFolder="$(DistDir)"
      Condition="'@(GenHttpAssemblies)' != ''" />
```

**Acceptance:** `dotnet build mod/mod.csproj` produces no ASP.NET Core DLLs in `$(DistDir)` and includes all `GenHTTP.*.dll` files.

---

## Phase 2 — Interface Conversion

### Task 2.1 — Rewrite `server/IEndpointModule.cs`

**Current state:**
```csharp
using Microsoft.AspNetCore.Routing;

namespace KROC.Server;

public interface IEndpointModule
{
    void Register(IEndpointRouteBuilder routes);
}
```

**Replace with:**
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

**Acceptance:** Compiles. The only external type used is `GenHTTP.Modules.Layouting.LayoutBuilder`.

---

## Phase 3 — Server Core Conversion

### Task 3.1 — Rewrite `server/KrocServer.cs`

**Current state:** Uses `WebApplication`, `WebApplication.CreateSlimBuilder()`, ASP.NET Core middleware pipeline (`app.Use(...)`), `Results.Ok()`, `HttpMethods`, `HttpContext`, etc.

**Replace entire file with a GenHTTP implementation:**

```csharp
using System;
using System.Collections.Generic;
using System.Net;
using System.Threading.Tasks;
using GenHTTP.Api.Content;
using GenHTTP.Api.Infrastructure;
using GenHTTP.Api.Protocol;
using GenHTTP.Engine.Internal;
using GenHTTP.Modules.ErrorHandling;
using GenHTTP.Modules.Functional;
using GenHTTP.Modules.IO;
using GenHTTP.Modules.Layouting;
using GenHTTP.Modules.Practices;
using GenHTTP.Modules.Security;

namespace KROC.Server;

/// <summary>GenHTTP server that hosts KROC endpoint modules.</summary>
public sealed class KrocServer
{
    private readonly KrocServerConfig _config;
    private readonly IReadOnlyList<IEndpointModule> _modules;
    private IServerHost? _host;

    public KrocServer(KrocServerConfig config, IReadOnlyList<IEndpointModule> modules)
    {
        _config = config;
        _modules = modules;
    }

    public async Task StartAsync()
    {
        if (!_config.Enabled)
        {
            Console.WriteLine("KROC: server is disabled, not starting.");
            return;
        }

        var api = Layout.Create();

        // /ping — proof-of-life
        var ping = Inline.Create()
                         .Get(() => new { status = "ok" });
        api.Add("ping", ping);

        // CORS — allow all origins
        api.Add(CorsPolicy.Permissive());

        // JSON error responses
        api.Add(ErrorHandler.From(new JsonErrorMapper()));

        // Feature modules
        foreach (var module in _modules)
            module.Register(api);

        _host = await Host.Create()
                          .Handler(api)
                          .Bind(IPAddress.Parse(_config.BindHost), (ushort)_config.Port)
                          .Defaults()
                          .StartAsync();

        Console.WriteLine($"KROC: server listening on http://{_config.BindHost}:{_config.Port}");
    }

    public async Task StopAsync()
    {
        if (_host is null)
            return;

        await _host.StopAsync();
        _host = null;

        Console.WriteLine("KROC: server stopped.");
    }

    /// <summary>Maps exceptions and 404s to JSON responses.</summary>
    private sealed class JsonErrorMapper : IErrorMapper<Exception>
    {
        public ValueTask<IResponse?> GetNotFound(IRequest request, IHandler handler)
        {
            var response = request.Respond()
                                  .Status(ResponseStatus.NotFound)
                                  .Content("{\"error\":\"not found\"}")
                                  .Type(FlexibleContentType.Get(ContentType.ApplicationJson))
                                  .Build();
            return new ValueTask<IResponse?>(response);
        }

        public ValueTask<IResponse?> Map(IRequest request, IHandler handler, Exception error)
        {
            Console.WriteLine($"KROC: unhandled exception in request: {error}");

            var status = error is ProviderException pe
                ? pe.Status
                : ResponseStatus.InternalServerError;

            var escaped = error.Message.Replace("\\", "\\\\").Replace("\"", "\\\"");
            var response = request.Respond()
                                  .Status(status)
                                  .Content($"{{\"error\":\"{escaped}\"}}")
                                  .Type(FlexibleContentType.Get(ContentType.ApplicationJson))
                                  .Build();
            return new ValueTask<IResponse?>(response);
        }
    }
}
```

Key differences from the ASP.NET Core version:
- `IServerHost` replaces `WebApplication`.
- `Host.Create().Bind()` replaces `builder.WebHost.UseUrls()`.
- `CorsPolicy.Permissive()` replaces inline CORS middleware.
- `ErrorHandler.From(new JsonErrorMapper())` replaces inline exception middleware.
- `Inline.Create().Get(...)` replaces `app.MapGet(...)`.
- `Layout.Create()` is the routing root passed to modules instead of `IEndpointRouteBuilder`.

**Acceptance:** `dotnet build server/server.csproj` succeeds with no errors or warnings.

---

## Phase 4 — Feature Module Conversion

### Task 4.1 — Rewrite `feat-ping/PingModule.cs`

**Current state:**
```csharp
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using KROC.Server;

namespace KROC.FeatPing;

public sealed class PingModule : IEndpointModule
{
    public void Register(IEndpointRouteBuilder routes)
    {
        routes.MapGet("/pong", () => Results.Text("pong", "text/plain"));
    }
}
```

**Replace with:**
```csharp
using GenHTTP.Api.Protocol;
using GenHTTP.Modules.Functional;
using GenHTTP.Modules.IO;
using GenHTTP.Modules.Layouting;
using KROC.Server;

namespace KROC.FeatPing;

/// <summary>
/// Ping feature module — registers a GET /pong endpoint that returns "pong" as text/plain.
/// </summary>
public sealed class PingModule : IEndpointModule
{
    public void Register(LayoutBuilder routes)
    {
        var pong = Inline.Create()
                         .Get((IRequest request) =>
                             request.Respond()
                                    .Content("pong")
                                    .Type(FlexibleContentType.Get(ContentType.TextPlain))
                                    .Build());

        routes.Add("pong", pong);
    }
}
```

**Acceptance:** `dotnet build feat-ping/feat-ping.csproj` succeeds. `GET /pong` returns `pong` with `Content-Type: text/plain`.

---

## Phase 5 — Mod Integration Cleanup

### Task 5.1 — Update `mod/Mod.cs` usings and server calls

**Current state:** `Mod.cs` already calls `_server.StartAsync()` and `_server.StopAsync()` correctly, and those signatures are unchanged. However:

1. `StartAsync()` no longer takes a `CancellationToken` parameter — verify the call site `_ = _server.StartAsync();` still compiles (it will, since the parameter was removed).
2. `StopAsync()` no longer takes a `CancellationToken` — verify `_server.StopAsync().GetAwaiter().GetResult();` compiles.

No functional changes expected in `Mod.cs` itself, but verify it builds clean.

**Acceptance:** `dotnet build mod/mod.csproj` succeeds with no errors or warnings.

---

## Phase 6 — Build Verification

### Task 6.1 — Full solution build

Run `dotnet build` at the solution root. Verify:
1. Zero errors.
2. Zero warnings (with `TreatWarningsAsErrors` enabled, this is equivalent).
3. No references to `Microsoft.AspNetCore.*` namespaces remain in any `.cs` file under `server/`, `feat-ping/`, or `mod/`.

### Task 6.2 — Smoke test

1. Start the mod in KSA (or run an integration test host if available).
2. `curl http://localhost:7887/ping` → `{"status":"ok"}` (200).
3. `curl http://localhost:7887/pong` → `pong` (200, text/plain).
4. `curl http://localhost:7887/nonexistent` → `{"error":"not found"}` (404).
5. Unload mod — server stops cleanly, no console errors.
