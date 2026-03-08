using System;
using Brutal.Numerics;
using GenHTTP.Api.Content;
using GenHTTP.Api.Protocol;
using GenHTTP.Modules.Conversion;
using GenHTTP.Modules.Functional;
using KSA;

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
            .Post((SetAttitudeRequest body) =>
            {
                try
                {
                    var v = Program.ControlledVehicle;
                    if (v is null)
                        return (object)new { status = "error", message = "No active vehicle" };

                    // Parse frame, default to EclBody
                    var frame = VehicleReferenceFrame.EclBody;
                    if (!string.IsNullOrWhiteSpace(body.Frame))
                    {
                        if (!Enum.TryParse<VehicleReferenceFrame>(body.Frame, ignoreCase: true, out var parsed))
                            throw new ProviderException(ResponseStatus.BadRequest,
                                $"Invalid frame '{body.Frame}'. Valid: EclBody, EnuBody, Lvlh, VlfBody, BurnBody, Dock.");
                        frame = parsed;
                    }

                    var fc = v.FlightComputer;
                    fc.AttitudeMode = FlightComputerAttitudeMode.Auto;
                    fc.AttitudeTrackTarget = FlightComputerAttitudeTrackTarget.Custom;
                    fc.AttitudeFrame = frame;
                    fc.CustomAttitudeTarget = new double3(body.Roll, body.Yaw, body.Pitch);

                    return (object)new
                    {
                        status = "ok",
                        data = new
                        {
                            mode = "Custom",
                            frame = frame.ToString(),
                            rollRad = body.Roll,
                            yawRad = body.Yaw,
                            pitchRad = body.Pitch,
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
                        "Unexpected error setting attitude.", ex);
                }
            })
            .Build();
    }
}
