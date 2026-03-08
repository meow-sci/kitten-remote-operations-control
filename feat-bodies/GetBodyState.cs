using System;
using System.Linq;
using GenHTTP.Api.Content;
using GenHTTP.Modules.Functional;
using KSA;

namespace KROC.FeatBodies;

/// <summary>
/// GET /bodies/state/:id
/// Returns the current ecliptic position and velocity of a celestial body.
/// </summary>
public static class GetBodyState
{
    public static IHandler Create()
    {
        return Inline.Create()
            .Get(":id", (string id) =>
            {
                try
                {
                    var body = FindBody(id);
                    if (body is null)
                        return (object)new { status = "error", message = $"Body '{id}' not found" };

                    var pos = body.GetPositionEcl();
                    var vel = body.GetVelocityEcl();

                    return (object)new
                    {
                        status = "ok",
                        data = new BodyStateData(
                            body.Id,
                            body.Class,
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

    internal static Celestial? FindBody(string id) =>
        Universe.CurrentSystem?.All.GetList()
            .OfType<Celestial>()
            .FirstOrDefault(b => string.Equals(b.Id, id, StringComparison.OrdinalIgnoreCase));
}
