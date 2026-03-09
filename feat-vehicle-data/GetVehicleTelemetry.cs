using System;
using Brutal.Numerics;
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
///   accelerationEcl     — same measured acceleration transformed into ecliptic coordinates
///   accelerationMps2    — scalar magnitude of accelerationBody
///   totalMassKg         — total wet mass (kg)
///   inertMassKg         — dry/structural mass (kg)
///   propellantMassKg    — current propellant mass (kg)
///   twrCurrent          — current thrust-to-weight ratio (throttle-scaled, 0 when engines off)
///   twrMax              — max TWR at current mass and full throttle
///   maxAccelMps2        — max acceleration in m/s² = twrMax × parent-body surface g
///                         Use maxAccelMps2 as the planning acceleration for brachistochrone
///                         calculations — it remains valid even when engines are cut.
///   parentBodyId        — current parent/reference body id for local navball frames
///   navballFrame        — current navball reference frame name
///   navballPitchDeg     — current game navball pitch display value
///   navballYawDeg       — current game navball yaw display value
///   navballRollDeg      — current game navball roll display value
///   bodyForwardEcl      — vehicle body +X axis in ecliptic coordinates
///   bodyUpEcl           — vehicle body +Z axis in ecliptic coordinates
///   activeEngineThrustN — live summed thrust from all currently firing nozzles (newtons)
///   thrustDirectionEcl  — live net engine thrust direction in ecliptic coordinates, including gimbal deflection
///   exhaustDirectionEcl — live net exhaust direction in ecliptic coordinates (opposite of thrustDirectionEcl)
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

                    static object Vec3Data(double3 value) => new { x = value.X, y = value.Y, z = value.Z };

                    var pos = v.GetPositionEcl();
                    var vel = v.GetVelocityEcl();
                    var acc = v.AccelerationBody;
                    var body2Ecl = doubleQuat.Concatenate(v.GetBody2Cci(), v.Parent.GetCci2Cce());
                    var accelerationEcl = acc.Transform(body2Ecl);
                    var bodyForwardEcl = double3.UnitX.Transform(body2Ecl);
                    var bodyUpEcl = double3.UnitZ.Transform(body2Ecl);
                    var thrustForceBody = double3.Zero;
                    var nozzleStates = v.Parts.RocketNozzles.ModulesAndStates.GetEnumerator();
                    while (nozzleStates.MoveNext())
                    {
                        var nozzle = nozzleStates.Current;
                        if (nozzle.State.Performance.TotalThrust <= 0f)
                            continue;

                        thrustForceBody += (double)nozzle.State.Performance.TotalThrust
                            * double3.Unpack(nozzle.State.ThrustDirectionVehicleAsmb);
                    }

                    var activeEngineThrustN = thrustForceBody.Length();
                    object? thrustDirectionEcl = null;
                    object? exhaustDirectionEcl = null;
                    if (activeEngineThrustN > 1e-9)
                    {
                        var thrustAxisBody = thrustForceBody / activeEngineThrustN;
                        var thrustAxisEcl = thrustAxisBody.Transform(body2Ecl);
                        thrustDirectionEcl = Vec3Data(thrustAxisEcl);
                        exhaustDirectionEcl = Vec3Data(-thrustAxisEcl);
                    }

                    var navAngles = v.NavBallData.AttitudeAngles;
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
                            positionEcl      = Vec3Data(pos),
                            velocityEcl      = Vec3Data(vel),
                            accelerationBody = Vec3Data(acc),
                            accelerationEcl  = Vec3Data(accelerationEcl),
                            accelerationMps2 = acc.Length(),
                            totalMassKg      = (double)v.TotalMass,
                            inertMassKg      = (double)v.InertMass,
                            propellantMassKg = (double)v.PropellantMass,
                            twrCurrent       = v.NavBallData.ThrustWeightRatio,
                            twrMax,
                            maxAccelMps2,
                            parentBodyId     = v.Parent.Id,
                            activeEngineThrustN,
                            thrustDirectionEcl,
                            exhaustDirectionEcl,
                            navballFrame     = v.NavBallData.Frame.ToString(),
                            navballPitchDeg  = navAngles.Y,
                            navballYawDeg    = navAngles.Z,
                            navballRollDeg   = navAngles.X,
                            bodyForwardEcl   = Vec3Data(bodyForwardEcl),
                            bodyUpEcl        = Vec3Data(bodyUpEcl),
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
