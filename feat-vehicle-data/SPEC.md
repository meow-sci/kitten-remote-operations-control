# Vehicle Data Feature — Task Spec

## Project / Framework Context

- **Language:** C# .NET 10
- **HTTP framework:** GenHTTP using `Inline.Create()` functional handler pattern
- **Feature contract:**
  ```csharp
  public interface IEndpointModule { void Register(LayoutBuilder routes); }
  ```
- Route trees are built with `Layout.Create()` and registered via `routes.Add("segment", layout)`.
- GenHTTP auto-serializes returned objects/records to JSON.
- **All responses** use one of two shapes:
  - Success: `{ "status": "ok", "data": ... }`
  - Error: `{ "status": "error", "message": "..." }`
- POST body parameters: declare a `record` type and GenHTTP deserializes from the JSON body automatically.
- Game types are accessed with `using KSA;`.

---

## [x] Task 1: List All Vehicles

**Endpoint:** `GET /vehicle/data/list`

**Description:** Returns a JSON array of all vehicles present in the current game system.

**Response shape (success):**
```json
{
  "status": "ok",
  "data": [
    { "id": "vehicle-123", "name": "My Rocket", "isControlled": true },
    { "id": "vehicle-456", "name": "Probe Alpha", "isControlled": false }
  ]
}
```

**Response shape (error):**
```json
{ "status": "error", "message": "Unexpected error while listing vehicles." }
```

**HTTP status codes:**
- 200 — success (empty array is valid when no vehicles exist)
- 500 — unexpected error

**KSA game code required:**
```csharp
using KSA;

var vehicles = Universe.CurrentSystem?.Vehicles.GetList() ?? Enumerable.Empty<Vehicle>();
Vehicle? controlled = Program.ControlledVehicle;

var items = vehicles.Select(v => new VehicleListItem(
    v.Id,
    v.Id,                          // Vehicle has no separate Name property; use Id as display name
    controlled is not null && v.Id == controlled.Id
));
```

**GenHTTP handler sketch:**
```csharp
public record VehicleListItem(string Id, string Name, bool IsControlled);
public record ApiResponse<T>(string Status, T? Data);

// Inside Register(LayoutBuilder routes):
var dataLayout = Layout.Create()
    .Add("list", Inline.Create().Get(() =>
    {
        try
        {
            var vehicles  = Universe.CurrentSystem?.Vehicles.GetList() ?? Enumerable.Empty<Vehicle>();
            Vehicle? ctrl = Program.ControlledVehicle;

            var items = vehicles
                .Select(v => new VehicleListItem(v.Id, v.Id, ctrl is not null && v.Id == ctrl.Id))
                .ToList();

            return new ApiResponse<List<VehicleListItem>>("ok", items);
        }
        catch (Exception ex)
        {
            throw new ProviderException(ResponseStatus.InternalServerError,
                "Unexpected error while listing vehicles.", ex);
        }
    }));

routes.Add("vehicle", Layout.Create()
    .Add("data", dataLayout));
```

**Acceptance criteria:**
- `GET /vehicle/data/list` returns `200` with `{ "status": "ok", "data": [...] }`.
- When no vehicles are in the system the `data` array is `[]`, not `null`.
- Each item contains exactly the fields `id`, `name`, `isControlled`.
- `isControlled` is `true` for at most one item (the currently controlled vehicle).
- A thrown game exception returns `500` with `{ "status": "error", "message": "..." }`.

---

## [x] Task 2: Get Currently Controlled Vehicle

**Endpoint:** `GET /vehicle/data/current`

**Description:** Returns the vehicle the player currently has control of, or `null` if no vehicle is controlled.

**Response shape (success — vehicle present):**
```json
{ "status": "ok", "data": { "id": "vehicle-123", "name": "My Rocket", "hasControl": true } }
```

**Response shape (success — no controlled vehicle):**
```json
{ "status": "ok", "data": null }
```

**Response shape (error):**
```json
{ "status": "error", "message": "Unexpected error retrieving current vehicle." }
```

**HTTP status codes:**
- 200 — success (null data is a valid success response)
- 500 — unexpected error

**KSA game code required:**
```csharp
using KSA;

Vehicle? current = Program.ControlledVehicle;

// If null, data = null
// Otherwise:
var data = new CurrentVehicleData(current.Id, current.Id, true);
```

**GenHTTP handler sketch:**
```csharp
public record CurrentVehicleData(string Id, string Name, bool HasControl);

// Inside the data layout (alongside "list"):
.Add("current", Inline.Create().Get(() =>
{
    try
    {
        Vehicle? current = Program.ControlledVehicle;
        if (current is null)
            return new ApiResponse<CurrentVehicleData?>("ok", null);

        return new ApiResponse<CurrentVehicleData?>("ok", new CurrentVehicleData(current.Id, current.Id, true));
    }
    catch (Exception ex)
    {
        throw new ProviderException(ResponseStatus.InternalServerError,
            "Unexpected error retrieving current vehicle.", ex);
    }
}));
```

**Acceptance criteria:**
- `GET /vehicle/data/current` returns `200` in all non-error cases.
- When a vehicle is controlled, `data` contains `id`, `name`, and `hasControl: true`.
- When no vehicle is controlled, `data` is JSON `null`.
- A thrown game exception returns `500` with `{ "status": "error", "message": "..." }`.

---

## [x] Task 3: Ignite Engine

**Endpoint:** `POST /vehicle/actions/ignite`

**Description:** Sends a main-engine ignite command to the vehicle identified by `vehicleId` in the request body.

**Response shape (success):**
```json
{ "status": "ok", "data": { "vehicleId": "vehicle-123", "status": "ignited" } }
```

**Response shape (error):**
```json
{ "status": "error", "message": "Missing or invalid vehicleId." }
```
```json
{ "status": "error", "message": "Vehicle not found: vehicle-999." }
```

**HTTP status codes:**
- 200 — engine ignition command sent successfully
- 400 — `vehicleId` is missing or empty
- 404 — no vehicle with the given ID found in the current system
- 500 — unexpected error

**KSA game code required:**
```csharp
using KSA;

var vehicles = Universe.CurrentSystem?.Vehicles.GetList() ?? Enumerable.Empty<Vehicle>();
var vehicle  = vehicles.FirstOrDefault(v => v.Id == vehicleId);

if (vehicle is null)
    // return 404

vehicle.SetEnum(VehicleEngine.MainIgnite);
```

**GenHTTP handler sketch:**
```csharp
public record VehicleActionRequest(string VehicleId);
public record VehicleActionResult(string VehicleId, string Status);

// Inside Register(LayoutBuilder routes), actions layout:
var actionsLayout = Layout.Create()
    .Add("ignite", Inline.Create().Post((VehicleActionRequest body) =>
    {
        if (string.IsNullOrWhiteSpace(body.VehicleId))
            throw new ProviderException(ResponseStatus.BadRequest, "Missing or invalid vehicleId.");

        var vehicles = Universe.CurrentSystem?.Vehicles.GetList() ?? Enumerable.Empty<Vehicle>();
        var vehicle  = vehicles.FirstOrDefault(v => v.Id == body.VehicleId);

        if (vehicle is null)
            throw new ProviderException(ResponseStatus.NotFound, $"Vehicle not found: {body.VehicleId}.");

        vehicle.SetEnum(VehicleEngine.MainIgnite);

        return new ApiResponse<VehicleActionResult>("ok", new VehicleActionResult(body.VehicleId, "ignited"));
    }));

routes.Add("vehicle", Layout.Create()
    .Add("actions", actionsLayout));
```

**Acceptance criteria:**
- `POST /vehicle/actions/ignite` with `{ "vehicleId": "<id>" }` returns `200` and calls `vehicle.SetEnum(VehicleEngine.MainIgnite)` on the matched vehicle.
- Missing or empty `vehicleId` returns `400`.
- An unknown `vehicleId` returns `404` with the ID echoed in the message.
- `data.status` in the success response is exactly `"ignited"`.
- `data.vehicleId` in the success response matches the input `vehicleId`.

---

## [x] Task 4: Shutdown Engine

**Endpoint:** `POST /vehicle/actions/shutdown`

**Description:** Sends a main-engine shutdown command to the vehicle identified by `vehicleId` in the request body.

**Response shape (success):**
```json
{ "status": "ok", "data": { "vehicleId": "vehicle-123", "status": "shutdown" } }
```

**Response shape (error):**
```json
{ "status": "error", "message": "Missing or invalid vehicleId." }
```
```json
{ "status": "error", "message": "Vehicle not found: vehicle-999." }
```

**HTTP status codes:**
- 200 — engine shutdown command sent successfully
- 400 — `vehicleId` is missing or empty
- 404 — no vehicle with the given ID found in the current system
- 500 — unexpected error

**KSA game code required:**
```csharp
using KSA;

var vehicles = Universe.CurrentSystem?.Vehicles.GetList() ?? Enumerable.Empty<Vehicle>();
var vehicle  = vehicles.FirstOrDefault(v => v.Id == vehicleId);

if (vehicle is null)
    // return 404

vehicle.SetEnum(VehicleEngine.MainShutdown);
```

**GenHTTP handler sketch:**
```csharp
// VehicleActionRequest and VehicleActionResult records are shared with Task 3.

// Inside the actions layout (alongside "ignite"):
.Add("shutdown", Inline.Create().Post((VehicleActionRequest body) =>
{
    if (string.IsNullOrWhiteSpace(body.VehicleId))
        throw new ProviderException(ResponseStatus.BadRequest, "Missing or invalid vehicleId.");

    var vehicles = Universe.CurrentSystem?.Vehicles.GetList() ?? Enumerable.Empty<Vehicle>();
    var vehicle  = vehicles.FirstOrDefault(v => v.Id == body.VehicleId);

    if (vehicle is null)
        throw new ProviderException(ResponseStatus.NotFound, $"Vehicle not found: {body.VehicleId}.");

    vehicle.SetEnum(VehicleEngine.MainShutdown);

    return new ApiResponse<VehicleActionResult>("ok", new VehicleActionResult(body.VehicleId, "shutdown"));
}));
```

**Acceptance criteria:**
- `POST /vehicle/actions/shutdown` with `{ "vehicleId": "<id>" }` returns `200` and calls `vehicle.SetEnum(VehicleEngine.MainShutdown)` on the matched vehicle.
- Missing or empty `vehicleId` returns `400`.
- An unknown `vehicleId` returns `404` with the ID echoed in the message.
- `data.status` in the success response is exactly `"shutdown"`.
- `data.vehicleId` in the success response matches the input `vehicleId`.

---

## [ ] Task 5: Refill Vehicle Consumables

**Endpoint:** `POST /vehicle/actions/refill`

**Description:** Sends a refill command to the vehicle identified by `vehicleId` in the request body, refilling all consumables (fuel, etc.).

**Response shape (success):**
```json
{ "status": "ok", "data": { "vehicleId": "vehicle-123", "status": "refilled" } }
```

**Response shape (error):**
```json
{ "status": "error", "message": "Missing or invalid vehicleId." }
```
```json
{ "status": "error", "message": "Vehicle not found: vehicle-999." }
```

**HTTP status codes:**
- 200 — refill command sent successfully
- 400 — `vehicleId` is missing or empty
- 404 — no vehicle with the given ID found in the current system
- 500 — unexpected error

**KSA game code required:**
```csharp
using KSA;

var vehicles = Universe.CurrentSystem?.Vehicles.GetList() ?? Enumerable.Empty<Vehicle>();
var vehicle  = vehicles.FirstOrDefault(v => v.Id == vehicleId);

if (vehicle is null)
    // return 404

vehicle.RefillConsumables();
```

**GenHTTP handler sketch:**
```csharp
// VehicleActionRequest and VehicleActionResult records are shared with Task 3.

// Inside the actions layout (alongside "ignite" and "shutdown"):
.Add("refill", Inline.Create().Post((VehicleActionRequest body) =>
{
    if (string.IsNullOrWhiteSpace(body.VehicleId))
        throw new ProviderException(ResponseStatus.BadRequest, "Missing or invalid vehicleId.");

    var vehicles = Universe.CurrentSystem?.Vehicles.GetList() ?? Enumerable.Empty<Vehicle>();
    var vehicle  = vehicles.FirstOrDefault(v => v.Id == body.VehicleId);

    if (vehicle is null)
        throw new ProviderException(ResponseStatus.NotFound, $"Vehicle not found: {body.VehicleId}.");

    try
    {
        vehicle.RefillConsumables();
        return new ApiResponse<VehicleActionResult>("ok", new VehicleActionResult(body.VehicleId, "refilled"));
    }
    catch (Exception ex)
    {
        throw new ProviderException(ResponseStatus.InternalServerError,
            "Unexpected error refilling vehicle.", ex);
    }
}));
```

**Acceptance criteria:**
- `POST /vehicle/actions/refill` with `{ "vehicleId": "<id>" }` returns `200` and calls `Universe.Refill(body.VehicleId)`.
- Missing or empty `vehicleId` returns `400`.
- An unknown `vehicleId` returns `404` with the ID echoed in the message.
- `data.status` in the success response is exactly `"refilled"`.
- `data.vehicleId` in the success response matches the input `vehicleId`.

---

## [ ] Task 6: OpenAPI Spec Coverage

**File:** `kroc-spec.yml` (project root)

**Description:** Create and maintain an OpenAPI 3.x compliant specification covering every endpoint exposed by this feature module.

**Endpoints to document:**

| Method | Path                        | Summary                          |
|--------|-----------------------------|----------------------------------|
| GET    | `/vehicle/data/list`        | List all vehicles                |
| GET    | `/vehicle/data/current`     | Get currently controlled vehicle |
| POST   | `/vehicle/actions/ignite`   | Ignite vehicle engine            |
| POST   | `/vehicle/actions/shutdown` | Shutdown vehicle engine          |
| POST   | `/vehicle/actions/refill`   | Refill vehicle consumables       |

**Acceptance criteria:**
- `kroc-spec.yml` exists at the project root and is valid OpenAPI 3.x.
- All four endpoints above have path entries with request/response schemas.
- Success responses use the `{ status: "ok", data: ... }` envelope schema.
- Error responses use the `{ status: "error", message: "..." }` envelope schema.
- POST endpoints document the `{ vehicleId: string }` request body.
- The spec is kept in sync with the implementation — updated in the same commit as any endpoint changes.
