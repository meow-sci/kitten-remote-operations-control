namespace KROC.FeatVehicleData;

public record VehicleListItem(string Id, string Name, bool IsControlled);

public record CurrentVehicleData(string Id, string Name, bool HasControl);

public record ApiResponse<T>(string Status, T? Data);

public record VehicleActionRequest(string VehicleId);

public record VehicleActionResult(string VehicleId, string Status);
