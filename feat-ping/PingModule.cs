using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using KROC.Server;

namespace KROC.FeatPing;

/// <summary>
/// Ping feature module — registers a GET /pong endpoint that returns "pong" as text/plain.
/// </summary>
public sealed class PingModule : IEndpointModule
{
    public void Register(IEndpointRouteBuilder routes)
    {
        routes.MapGet("/pong", () => Results.Text("pong", "text/plain"));
    }
}
