using GenHTTP.Modules.Layouting;
using GenHTTP.Modules.Layouting.Provider;
using KROC.Server;

namespace KROC.FeatBodies;

public sealed class BodiesModule : IEndpointModule
{
    public void Register(LayoutBuilder routes)
    {
        var bodies = Layout.Create()
            .Add("list",    GetBodiesList.Create())  // GET /bodies/list
            .Add("state",   GetBodyState.Create())   // GET /bodies/state/:id
            .Add("predict", GetBodyPredict.Create()); // GET /bodies/predict/:id?simTimeSec=<s>

        routes.Add("bodies", bodies);
    }
}
