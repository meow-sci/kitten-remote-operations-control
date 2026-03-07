---
description: general instructions
applyTo: "**/*"
---

## Project Overview

This is **KROC** (Kitten Remote Operations Control), a mod for the game **Kitten Space Agency (KSA)**, written in **C# / .NET 10**. It exposes an HTTP API so external tools can read vehicle telemetry and send commands to the game.

## Project Structure

- `decomp/ksa/` — decompiled KSA game assemblies. These can be very large; **only read them when you need to look up a specific KSA type or API**.
- `mod/` — main mod entry point (`Mod.cs`, `mod.csproj`, `mod.toml`). Initialises `KrocServer` and registers all feature modules.
- `server/` — shared server infrastructure: `KrocServer`, `KrocServerConfig`, `IEndpointModule`.
- `core/` — shared utilities referenced by features.
- `feat-*/` — individual feature projects. Each is a `.csproj` that references `server.csproj` and is referenced by `mod.csproj`.

## How Features Work

Every feature implements `IEndpointModule` from `server/IEndpointModule.cs`:

```csharp
public interface IEndpointModule
{
    void Register(LayoutBuilder routes);
}
```

During startup, `KrocServer` calls `Register` on each module, passing the root `LayoutBuilder`. Features add their own sub-layouts to build URL hierarchies. `KrocServer` already configures CORS, JSON error handling, and a `/health` endpoint.

## GenHTTP Functional Framework

Routes are defined with the `Inline.Create()` builder from `GenHTTP.Modules.Functional`:

```csharp
// GET — query-string params injected by name
Inline.Create().Get((int page, int pageSize) => new { … })

// GET — path segment
Inline.Create().Get(":id", (int id) => new { … })

// POST — body is deserialized automatically from JSON
Inline.Create().Post((MyRequest body) => new { … })

// Return plain object — serialized to JSON automatically
Inline.Create().Get(() => new { status = "ok", data = someObject })

// Return a specific HTTP status (e.g. 404)
using GenHTTP.Api.Protocol;
Inline.Create().Get((IRequest req) =>
    req.Respond().Status(ResponseStatus.NotFound).Build())

// Nesting layouts
var actions = Inline.Create().Post(…);
var vehicle = Layout.Create();
vehicle.Add("actions", actions);
routes.Add("vehicle", vehicle);  // → /vehicle/actions
```

## JSON Response Conventions

All endpoints must wrap responses in the standard envelope:

```json
// success
{ "status": "ok", "data": <payload> }

// error
{ "status": "error", "message": "<description>" }
```

POST endpoints that target a vehicle accept:

```json
{ "vehicleId": "vehicle-123" }
```

## KSA Game Types

```csharp
using KSA;

// All vehicles in the current save
var vehicles = Universe.CurrentSystem?.Vehicles.GetList();

// The vehicle the player is currently controlling
var active = Program.ControlledVehicle;

// Engine actions
vehicle.SetEnum(VehicleEngine.MainIgnite);
vehicle.SetEnum(VehicleEngine.MainShutdown);
```

## Minimal Feature Example

```csharp
using GenHTTP.Api.Protocol;
using GenHTTP.Modules.Functional;
using GenHTTP.Modules.Layouting.Provider;
using KSA;
using KROC.Server;

namespace KROC.FeatExample;

public sealed class ExampleModule : IEndpointModule
{
    public void Register(LayoutBuilder routes)
    {
        var inline = Inline.Create()
            .Get(() =>
            {
                var vehicle = Program.ControlledVehicle;
                if (vehicle is null)
                    return new { status = "error", message = "No active vehicle" };
                return (object)new { status = "ok", data = new { vehicle.Name } };
            })
            .Post((VehicleRequest body) =>
            {
                try
                {
                    var vehicle = Universe.CurrentSystem?.Vehicles.GetList()
                        .FirstOrDefault(v => v.Id == body.VehicleId);
                    if (vehicle is null)
                        return new { status = "error", message = "Vehicle not found" };
                    vehicle.SetEnum(VehicleEngine.MainIgnite);
                    return (object)new { status = "ok", data = (object?)null };
                }
                catch (Exception ex)
                {
                    return new { status = "error", message = ex.Message };
                }
            });

        routes.Add("example", inline);
    }
}

public record VehicleRequest(string VehicleId);
```
