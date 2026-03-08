using System;
using GenHTTP.Api.Content;
using GenHTTP.Modules.Functional;
using KSA;

namespace KROC.FeatVehicleData;

/// <summary>
/// GET /vehicle/telemetry
///
/// Returns a snapshot of the controlled vehicle's full kinematic state —
/// everything needed to continuously recompute a brachistochrone transfer plan:
///
///   simTimeSec          — current game simulation time (seconds since epoch)
///   positionEcl         — ecliptic-frame position in metres
///   velocityEcl         — ecliptic-frame velocity in m/s
///   accelerationBody    — body-frame acceleration vector in m/s² (thrust + gravity)
///   accelerationMps2    — scalar magnitude of accelerationBody
///   totalMassKg         — total wet mass (kg)
///   inertMassKg         — dry/structural mass (kg)
///   propellantMassKg    — current propellant mass (kg)
///   twrCurrent          — current thrust-to-weight ratio (throttle-scaled, 0 when engines off)
///   twrMax              — max TWR at current mass and full throttle
///   maxAccelMps2        — max acceleration in m/s² = twrMax × parent-body surface g
///                         Use maxAccelMps2 as the planning acceleration for brachistochrone
///                         calculations — it remains valid even when engines are cut.
///
/// accelerationMps2 is the measured body-frame acceleration magnitude. It drops
/// to ~0 during refill pauses. Use maxAccelMps2 for planning instead.
/// </summary>
public static class GetVehicleTelemetry
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

                    var pos = v.GetPositionEcl();
                    var vel = v.GetVelocityEcl();
                    var acc = v.AccelerationBody;
                    var simTimeSec = Universe.GetElapsedSimTime().Seconds();

                    // TWR and max acceleration
                    var fc = v.FlightComputer;
                    double gSurface = 6.6743e-11 * v.Parent.Mass / (v.Parent.MeanRadius * v.Parent.MeanRadius);
                    double maxThrustN = (double)fc.VehicleConfig.TotalEngineVacuumThrust;
                    double weightN    = (double)v.TotalMass * gSurface;
                    double twrMax     = weightN > 0.0 ? maxThrustN / weightN : 0.0;
                    double maxAccelMps2 = twrMax * gSurface;

                    return (object)new
                    {
                        status = "ok",
                        data = new
                        {
                            simTimeSec,
                            positionEcl      = new { x = pos.X, y = pos.Y, z = pos.Z },
                            velocityEcl      = new { x = vel.X, y = vel.Y, z = vel.Z },
                            accelerationBody = new { x = acc.X, y = acc.Y, z = acc.Z },
                            accelerationMps2 = acc.Length(),
                            totalMassKg      = (double)v.TotalMass,
                            inertMassKg      = (double)v.InertMass,
                            propellantMassKg = (double)v.PropellantMass,
                            twrCurrent       = v.NavBallData.ThrustWeightRatio,
                            twrMax,
                            maxAccelMps2,
                        }
                    };
                }
                catch (Exception ex)
                {
                    return (object)new { status = "error", message = ex.Message };
                }
            })
            .Build();
    }
}
