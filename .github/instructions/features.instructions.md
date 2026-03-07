---
description: Instructions for implementing feature modules in feat-*/ folders
applyTo: '**/feat-*/**'
---

# Feature Development Instructions

## Structure

- A feature lives in `feat-<name>/` with its own `feat-<name>.csproj`.
- The `.csproj` must reference `../server/server.csproj`.
- The feature class is `public sealed class <Name>Module : IEndpointModule`.
- `mod.csproj` references the feature project, and `Mod.cs` instantiates and registers the module.
- DO NOT generate unit tests, these exclusively use real game code and can't be effectively unit tested

## Implementing IEndpointModule

```csharp
using GenHTTP.Modules.Layouting.Provider;
using KROC.Server;

namespace KROC.Feat<Name>;

public sealed class <Name>Module : IEndpointModule
{
    public void Register(LayoutBuilder routes)
    {
        // add routes here
    }
}
```

## Defining Routes with Inline.Create()

Use `GenHTTP.Modules.Functional.Inline` for all route handlers. GenHTTP wires up parameters automatically:

```csharp
// GET — return any object, serialized to JSON automatically
var handler = Inline.Create()
    .Get(() => new { status = "ok", data = someValue });

// GET with path segment
var handler = Inline.Create()
    .Get(":id", (string id) => new { status = "ok", data = id });

// POST — body type deserialized from JSON automatically
var handler = Inline.Create()
    .Post((VehicleRequest body) => new { status = "ok", data = (object?)null });

// Register under a path
routes.Add("my-feature", handler);
```

## Building Path Hierarchies

Use `Layout.Create()` to nest paths:

```csharp
using GenHTTP.Modules.Layouting;

var actions = Inline.Create().Post(…);
var data    = Inline.Create().Get(…);

var vehicle = Layout.Create();
vehicle.Add("actions", actions);  // → /vehicle/actions
vehicle.Add("data",    data);     // → /vehicle/data

routes.Add("vehicle", vehicle);
```

## JSON Response Conventions

Always wrap every response in the standard envelope — no raw values:

```csharp
// success
new { status = "ok",    data = payload }

// error
new { status = "error", message = "description" }
```

## POST Requests Targeting a Vehicle

Declare a request record at the bottom of the file and accept it as the body parameter:

```csharp
public record VehicleRequest(string VehicleId);

// in Register:
var handler = Inline.Create()
    .Post((VehicleRequest body) =>
    {
        var vehicle = Universe.CurrentSystem?.Vehicles.GetList()
            .FirstOrDefault(v => v.Id == body.VehicleId);
        if (vehicle is null)
            return new { status = "error", message = "Vehicle not found" };
        // … do something …
        return (object)new { status = "ok", data = (object?)null };
    });
```

## Accessing KSA Game State

```csharp
using KSA;

// All vehicles
var list = Universe.CurrentSystem?.Vehicles.GetList();

// Player-controlled vehicle
var active = Program.ControlledVehicle;

// Engine commands
vehicle.SetEnum(VehicleEngine.MainIgnite);
vehicle.SetEnum(VehicleEngine.MainShutdown);
```

Always null-check `Universe.CurrentSystem` before use.

## HTTP Status Codes

```csharp
using GenHTTP.Api.Protocol;

// 404
request.Respond().Status(ResponseStatus.NotFound).Build()

// 400
request.Respond().Status(ResponseStatus.BadRequest).Build()
```

For handlers that may need to return status codes, add `IRequest request` as a parameter.

## Exception Handling

Wrap game calls in try/catch and return the error envelope:

```csharp
try
{
    // game call
    return (object)new { status = "ok", data = result };
}
catch (Exception ex)
{
    return new { status = "error", message = ex.Message };
}
```

## Complete Minimal Example

```csharp
using GenHTTP.Api.Protocol;
using GenHTTP.Modules.Functional;
using GenHTTP.Modules.Layouting;
using GenHTTP.Modules.Layouting.Provider;
using KSA;
using KROC.Server;

namespace KROC.FeatExample;

public sealed class ExampleModule : IEndpointModule
{
    public void Register(LayoutBuilder routes)
    {
        // GET /example — return active vehicle name
        var getActive = Inline.Create()
            .Get(() =>
            {
                var v = Program.ControlledVehicle;
                if (v is null)
                    return new { status = "error", message = "No active vehicle" };
                return (object)new { status = "ok", data = new { v.Name } };
            });

        // POST /example/ignite — ignite engine on a named vehicle
        var ignite = Inline.Create()
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

        var layout = Layout.Create();
        layout.Add("ignite", ignite);    // → /example/ignite
        routes.Add("example", getActive); // → GET /example
        routes.Add("example", layout);    // → /example/ignite
    }
}

public record VehicleRequest(string VehicleId);
```

## OpenAPI Spec

Every endpoint a feature exposes **must** be reflected in `kroc-spec.yml` at the project root (OpenAPI 3.x).

- Add a path entry for each new route.
- Use `$ref` to shared response schemas where possible.
- Keep the spec in sync: update it in the same commit as the feature code.
- Add a row to `FEATURES.md` for each new endpoint.

## Checklist

- [ ] `.csproj` references `../server/server.csproj`
- [ ] Class is `public sealed` and implements `IEndpointModule`
- [ ] All responses use `{ status, data }` or `{ status, message }` envelope
- [ ] `Universe.CurrentSystem` null-checked before use
- [ ] Game calls wrapped in try/catch
- [ ] Module registered in `Mod.cs`
- [ ] Endpoint(s) documented in `kroc-spec.yml`
- [ ] Feature endpoint(s) added to `FEATURES.md`