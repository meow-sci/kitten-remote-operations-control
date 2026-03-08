using System;
using GenHTTP.Api.Content;
using GenHTTP.Modules.Functional;
using KSA;

namespace KROC.FeatBodies;

/// <summary>
/// GET /bodies/predict/:id?simTimeSec=&lt;seconds&gt;
///
/// Returns the analytically-computed ecliptic position and velocity of a
/// celestial body at a specific future (or past) simulation time.
///
/// This uses KSA's Keplerian propagator, so it is exact for any time offset —
/// no linear approximation. Use this endpoint in the brachistochrone intercept
/// iteration loop: supply the estimated arrival simTimeSec, get back Mars's
/// exact ecliptic position at that time, recompute trip time, repeat.
/// </summary>
public static class GetBodyPredict
{
    public static IHandler Create()
    {
        return Inline.Create()
            .Get(":id", (string id, double simTimeSec) =>
            {
                try
                {
                    var body = GetBodyState.FindBody(id);
                    if (body is null)
                        return (object)new { status = "error", message = $"Body '{id}' not found" };

                    var t = new SimTime(simTimeSec);
                    var pos = body.GetPositionEcl(t);
                    var vel = body.GetVelocityEcl(t);

                    return (object)new
                    {
                        status = "ok",
                        data = new BodyPredictData(
                            body.Id,
                            simTimeSec,
                            new Vec3(pos.X, pos.Y, pos.Z),
                            new Vec3(vel.X, vel.Y, vel.Z))
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
