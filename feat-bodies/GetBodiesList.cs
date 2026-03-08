using System;
using System.Linq;
using GenHTTP.Api.Content;
using GenHTTP.Modules.Functional;
using KSA;

namespace KROC.FeatBodies;

public static class GetBodiesList
{
    public static IHandler Create()
    {
        return Inline.Create()
            .Get(() =>
            {
                try
                {
                    var system = Universe.CurrentSystem;
                    if (system is null)
                        return (object)new { status = "error", message = "No system loaded" };

                    var bodies = system.All.GetList()
                        .OfType<Celestial>()
                        .Select(b => new BodiesListItem(b.Id, b.Class, b.MeanRadius))
                        .ToList();

                    return (object)new { status = "ok", data = bodies };
                }
                catch (Exception ex)
                {
                    return (object)new { status = "error", message = ex.Message };
                }
            })
            .Build();
    }
}
