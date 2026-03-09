using System;
using GenHTTP.Api.Content;
using GenHTTP.Api.Protocol;
using GenHTTP.Modules.Functional;
using KSA;

namespace KROC.FeatFlightComputer;

/// <summary>
/// GET /flight-computer/state
///
/// Returns the current flight computer state for the controlled vehicle:
/// attitude mode, track target, reference frame, custom euler angles,
/// attitude error, deadband, and rate limit.
/// </summary>
public static class GetFlightComputerState
{
    public static IHandler Create()
    {
        return Inline.Create()
            .Get(() =>
            {
                try
                {
                    var v = Program.ControlledVehicle;
                    if (v is null)
                        return (object)new { status = "error", message = "No active vehicle" };

                    var fc = v.FlightComputer;
                    var custom = fc.CustomAttitudeTarget;
                    var errors = fc.ErrorAngles;

                    // Determine which profile matches current deadband/rateLimit
                    string profile = "Custom";
                    if (fc.HasAttitudeProfile(FlightComputerAttitudeProfile.Strict))
                        profile = "Strict";
                    else if (fc.HasAttitudeProfile(FlightComputerAttitudeProfile.Balanced))
                        profile = "Balanced";
                    else if (fc.HasAttitudeProfile(FlightComputerAttitudeProfile.Relaxed))
                        profile = "Relaxed";

                    var data = new FlightComputerStateData(
                        AttitudeMode: fc.AttitudeMode.ToString(),
                        TrackTarget: fc.AttitudeTrackTarget.ToString(),
                        Frame: fc.AttitudeFrame.ToString(),
                        RollMode: fc.RollMode.ToString(),
                        BurnMode: fc.BurnMode.ToString(),
                        Profile: profile,
                        CustomRollRad: custom.X,
                        CustomYawRad: custom.Z,
                        CustomPitchRad: custom.Y,
                        ErrorRollDeg: errors.X * (180.0 / Math.PI),
                        ErrorYawDeg: errors.Z * (180.0 / Math.PI),
                        ErrorPitchDeg: errors.Y * (180.0 / Math.PI),
                        AngleDeadbandDeg: fc.AngleDeadband * (180.0 / Math.PI),
                        RateLimitDegPerSec: fc.RateLimit * (180.0 / Math.PI)
                    );

                    return (object)new { status = "ok", data };
                }
                catch (Exception ex)
                {
                    return (object)new { status = "error", message = ex.Message };
                }
            })
            .Build();
    }
}
