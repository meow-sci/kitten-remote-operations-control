using GenHTTP.Api.Protocol;
using GenHTTP.Modules.Functional;
using GenHTTP.Modules.IO;
using GenHTTP.Modules.Layouting.Provider;
using KROC.Server;

namespace KROC.FeatPing;

/// <summary>
/// Ping feature module — registers a GET /pong endpoint that returns "pong" as text/plain.
/// </summary>
public sealed class PingModule : IEndpointModule
{
    public void Register(LayoutBuilder routes)
    {
        var pong = Inline.Create()
                         .Get((IRequest request) =>
                             request.Respond()
                                    .Content("pong")
                                    .Type(FlexibleContentType.Get(ContentType.TextPlain))
                                    .Build());

        routes.Add("pong", pong);
    }
}
