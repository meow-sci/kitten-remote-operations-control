using Microsoft.AspNetCore.Routing;

namespace KROC.Server;

/// <summary>
/// Implemented by feature projects to register Minimal API routes.
/// Called once during server startup before app.StartAsync().
/// </summary>
public interface IEndpointModule
{
    void Register(IEndpointRouteBuilder routes);
}
