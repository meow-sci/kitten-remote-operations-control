using System.Text.Json;
using caTTY.Core.Rpc.Socket;
using KSA;
using Microsoft.Extensions.Logging;

namespace caTTY.TermSequenceRpc.SocketRpc.Actions;

/// <summary>
/// Gets the currently controlled craft/vehicle.
/// Returns craft info or null if no craft is controlled.
/// </summary>
public class GetCurrentCraftAction : ISocketRpcAction
{
    private readonly ILogger _logger;

    public string ActionName => "get-current-craft";

    public GetCurrentCraftAction(ILogger logger)
    {
        _logger = logger;
    }

    public SocketRpcResponse Execute(JsonElement? @params)
    {
        try
        {
            Console.WriteLine("Executing get-current-craft action");
            var vehicle = Program.ControlledVehicle;
            if (vehicle == null)
            {
                _logger.LogDebug("get-current-craft: no vehicle controlled");
                return SocketRpcResponse.Ok(null);
            }

            var craftInfo = new
            {
                name = "Controlled Vehicle",
                hasControl = true
            };

            _logger.LogDebug("get-current-craft returning controlled vehicle");
            return SocketRpcResponse.Ok(craftInfo);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to get current craft");
            return SocketRpcResponse.Fail($"Failed to get current craft: {ex.Message}");
        }
    }
}
