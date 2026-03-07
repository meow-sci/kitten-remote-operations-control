using System.Text.Json;
using caTTY.Core.Rpc.Socket;
using KSA;
using Microsoft.Extensions.Logging;

namespace caTTY.TermSequenceRpc.SocketRpc.Actions;

/// <summary>
/// Shuts down the main engine of a vehicle by ID.
/// Takes a single parameter: vehicleId (string).
/// </summary>
public class ShutdownAction : ISocketRpcAction
{
    private readonly ILogger _logger;

    public string ActionName => "shutdown";

    public ShutdownAction(ILogger logger)
    {
        _logger = logger;
    }

    public SocketRpcResponse Execute(JsonElement? @params)
    {
        try
        {
            // Extract vehicleId from params
            if (@params == null || @params.Value.ValueKind == JsonValueKind.Null)
            {
                return SocketRpcResponse.Fail("Missing vehicleId parameter");
            }

            string? vehicleId = null;

            // Handle both direct string or object with vehicleId property
            if (@params.Value.ValueKind == JsonValueKind.String)
            {
                vehicleId = @params.Value.GetString();
            }
            else if (@params.Value.ValueKind == JsonValueKind.Object)
            {
                if (@params.Value.TryGetProperty("vehicleId", out var idProp))
                {
                    vehicleId = idProp.GetString();
                }
            }

            if (string.IsNullOrEmpty(vehicleId))
            {
                return SocketRpcResponse.Fail("Invalid or missing vehicleId");
            }

            _logger.LogDebug("Attempting to shutdown vehicle: {VehicleId}", vehicleId);

            // Find vehicle in Universe
            var vehicles = Universe.CurrentSystem?.Vehicles.GetList() ?? Enumerable.Empty<Vehicle>();
            var vehicle = vehicles.FirstOrDefault(v => v.Id == vehicleId);

            if (vehicle == null)
            {
                _logger.LogWarning("Vehicle not found: {VehicleId}", vehicleId);
                return SocketRpcResponse.Fail($"Vehicle not found: {vehicleId}");
            }

            // Shutdown the engine
            vehicle.SetEnum(VehicleEngine.MainShutdown);
            _logger.LogInformation("Shutdown vehicle: {VehicleId}", vehicleId);

            return SocketRpcResponse.Ok(new
            {
                vehicleId = vehicleId,
                status = "shutdown"
            });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to shutdown vehicle");
            return SocketRpcResponse.Fail($"Failed to shutdown vehicle: {ex.Message}");
        }
    }
}
