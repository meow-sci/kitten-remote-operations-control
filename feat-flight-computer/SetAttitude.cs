using System;
using System.Threading.Tasks;
using Brutal.Numerics;
using GenHTTP.Api.Content;
using GenHTTP.Api.Protocol;
using GenHTTP.Modules.Conversion;
using GenHTTP.Modules.Functional;
using KSA;
using KROC.GameStateUpdater;

namespace KROC.FeatFlightComputer;

/// <summary>
/// POST /flight-computer/attitude
///
/// Sets the flight computer to hold a custom attitude (euler angles) in a
/// chosen reference frame. Switches to Auto + Custom tracking mode.
///
/// The EclBody frame is ecliptic-inertial, so you can convert an ecliptic
/// direction vector (lon, lat) directly:
///   yaw   = longitude in radians
///   pitch = latitude in radians
///   roll  = 0
///
/// Euler order for all frames except EnuBody is Roll-Yaw-Pitch.
/// EnuBody uses Roll-Pitch-Yaw.
/// </summary>
public static class SetAttitude
{
    public static IHandler Create()
    {
        return Inline.Create()
            .Serializers(Serialization.Default())
            .Post(async (SetAttitudeRequest body) =>
            {
                // Validation only — no game state access
                var frame = VehicleReferenceFrame.EclBody;
                if (!string.IsNullOrWhiteSpace(body.Frame))
                {
                    if (!Enum.TryParse<VehicleReferenceFrame>(body.Frame, ignoreCase: true, out var parsed))
                        throw new ProviderException(ResponseStatus.BadRequest,
                            $"Invalid frame '{body.Frame}'. Valid: EclBody, EnuBody, Lvlh, VlfBody, BurnBody, Dock.");
                    frame = parsed;
                }

                try
                {
                    var capturedFrame = frame;
                    var result = await GameThread.Scheduler.Schedule(() =>
                    {
                        var v = Program.ControlledVehicle;
                        if (v is null)
                            throw new ProviderException(ResponseStatus.BadRequest, "No active vehicle.");

                        var fc = v.FlightComputer;
                        fc.AttitudeMode = FlightComputerAttitudeMode.Auto;
                        fc.AttitudeTrackTarget = FlightComputerAttitudeTrackTarget.Custom;
                        fc.AttitudeFrame = capturedFrame;
                        fc.CustomAttitudeTarget = new double3(body.Roll, body.Yaw, body.Pitch);

                        return new
                        {
                            mode = "Custom",
                            frame = capturedFrame.ToString(),
                            rollRad = body.Roll,
                            yawRad = body.Yaw,
                            pitchRad = body.Pitch,
                        };
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
                        "Unexpected error setting attitude.", ex);
                }
            })
            .Build();
    }
}
