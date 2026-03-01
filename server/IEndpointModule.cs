using GenHTTP.Modules.Layouting.Provider;

namespace KROC.Server;

/// <summary>
/// Implemented by feature projects to register routes on a GenHTTP layout.
/// Called once during server startup before host.StartAsync().
/// </summary>
public interface IEndpointModule
{
    void Register(LayoutBuilder routes);
}
