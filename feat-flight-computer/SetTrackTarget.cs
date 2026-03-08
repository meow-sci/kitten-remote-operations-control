using System;
using GenHTTP.Api.Content;
using GenHTTP.Api.Protocol;
using GenHTTP.Modules.Conversion;
using GenHTTP.Modules.Functional;
using KSA;

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
            .Post((SetTrackTargetRequest body) =>
            {
                try
                {
                    var v = Program.ControlledVehicle;
                    if (v is null)
                        return (object)new { status = "error", message = "No active vehicle" };

                    if (string.IsNullOrWhiteSpace(body.Target))
                        throw new ProviderException(ResponseStatus.BadRequest, "Missing target.");

                    if (!Enum.TryParse<FlightComputerAttitudeTrackTarget>(body.Target, ignoreCase: true, out var target))
                        throw new ProviderException(ResponseStatus.BadRequest,
                            $"Invalid target '{body.Target}'. Valid: None, Custom, Forward, Backward, Up, Down, " +
                            "Ahead, Behind, RadialOut, RadialIn, Prograde, Retrograde, Normal, AntiNormal, " +
                            "Outward, Inward, PositiveDv, NegativeDv, Toward, Away, Antivel, Align.");

                    // Use SetEnum which also updates the navball frame
                    v.SetEnum(target);

                    return (object)new
                    {
                        status = "ok",
                        data = new
                        {
                            target = target.ToString(),
                        }
                    };
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
