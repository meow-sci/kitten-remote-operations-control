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
///
/// accelerationMps2 is the effective a = F/m while engines are burning.
/// When engines are cut for a refill it will read near-zero; supply a fixed
/// planning value as a script argument instead of relying on this field.
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
