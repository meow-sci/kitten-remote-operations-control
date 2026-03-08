using System;
using System.Threading.Tasks;
using GenHTTP.Api.Content;
using GenHTTP.Api.Protocol;
using GenHTTP.Modules.Conversion;
using GenHTTP.Modules.Functional;
using KSA;
using KROC.GameStateUpdater;

namespace KROC.FeatFlightComputer;

/// <summary>
/// POST /flight-computer/track
///
/// Sets the flight computer to track a named target direction (e.g. Prograde,
/// Retrograde, Normal). Switches to Auto mode and the appropriate navball frame.
/// </summary>
public static class SetTrackTarget
{
    public static IHandler Create()
    {
        return Inline.Create()
            .Serializers(Serialization.Default())
            .Post(async (SetTrackTargetRequest body) =>
            {
                // Validation only — no game state access
                if (string.IsNullOrWhiteSpace(body.Target))
                    throw new ProviderException(ResponseStatus.BadRequest, "Missing target.");

                if (!Enum.TryParse<FlightComputerAttitudeTrackTarget>(body.Target, ignoreCase: true, out var target))
                    throw new ProviderException(ResponseStatus.BadRequest,
                        $"Invalid target '{body.Target}'. Valid: None, Custom, Forward, Backward, Up, Down, " +
                        "Ahead, Behind, RadialOut, RadialIn, Prograde, Retrograde, Normal, AntiNormal, " +
                        "Outward, Inward, PositiveDv, NegativeDv, Toward, Away, Antivel, Align.");

                try
                {
                    var capturedTarget = target;
                    var result = await GameThread.Scheduler.Schedule(() =>
                    {
                        var v = Program.ControlledVehicle;
                        if (v is null)
                            throw new ProviderException(ResponseStatus.BadRequest, "No active vehicle.");

                        // Use SetEnum which also updates the navball frame
                        v.SetEnum(capturedTarget);
                        return new { target = capturedTarget.ToString() };
                    });

                    return (object)new { status = "ok", data = result };
                }
                catch (ProviderException)
                {
                    throw;
                }
                catch (Exception ex)
                {
                    throw new ProviderException(ResponseStatus.InternalServerError,
                        "Unexpected error setting track target.", ex);
                }
            })
            .Build();
    }
}
