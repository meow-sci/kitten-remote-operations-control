using System;
using System.Collections.Generic;
using System.Net;
using System.Threading.Tasks;
using GenHTTP.Api.Content;
using GenHTTP.Api.Infrastructure;
using GenHTTP.Api.Protocol;
using GenHTTP.Engine.Internal;
using GenHTTP.Modules.ErrorHandling;
using GenHTTP.Modules.Functional;
using GenHTTP.Modules.IO;
using GenHTTP.Modules.Layouting;
using GenHTTP.Modules.Practices;
using GenHTTP.Modules.Security;

namespace KROC.Server;

/// <summary>GenHTTP server that hosts KROC endpoint modules.</summary>
public sealed class KrocServer
{
    private readonly KrocServerConfig _config;
    private readonly IReadOnlyList<IEndpointModule> _modules;
    private IServerHost? _host;

    public KrocServer(KrocServerConfig config, IReadOnlyList<IEndpointModule> modules)
    {
        _config = config;
        _modules = modules;
    }

    public async Task StartAsync()
    {
        if (!_config.Enabled)
        {
            Console.WriteLine("KROC: server is disabled, not starting.");
            return;
        }

        var api = Layout.Create();

        // /ping — proof-of-life
        var ping = Inline.Create()
                         .Get(() => new { status = "ok" });
        api.Add("ping", ping);

        // CORS — allow all origins
        api.Add(CorsPolicy.Permissive());

        // JSON error responses
        api.Add(ErrorHandler.From(new JsonErrorMapper()));

        // Feature modules
        foreach (var module in _modules)
            module.Register(api);

        _host = await Host.Create()
                          .Handler(api)
                          .Bind(IPAddress.Parse(_config.BindHost), (ushort)_config.Port)
                          .Defaults()
                          .StartAsync();

        Console.WriteLine($"KROC: server listening on http://{_config.BindHost}:{_config.Port}");
    }

    public async Task StopAsync()
    {
        if (_host is null)
            return;

        await _host.StopAsync();
        _host = null;

        Console.WriteLine("KROC: server stopped.");
    }

    /// <summary>Maps exceptions and 404s to JSON responses.</summary>
    private sealed class JsonErrorMapper : IErrorMapper<Exception>
    {
        public ValueTask<IResponse?> GetNotFound(IRequest request, IHandler handler)
        {
            var response = request.Respond()
                                  .Status(ResponseStatus.NotFound)
                                  .Content("{\"error\":\"not found\"}")
                                  .Type(FlexibleContentType.Get(ContentType.ApplicationJson))
                                  .Build();
            return new ValueTask<IResponse?>(response);
        }

        public ValueTask<IResponse?> Map(IRequest request, IHandler handler, Exception error)
        {
            Console.WriteLine($"KROC: unhandled exception in request: {error}");

            var status = error is ProviderException pe
                ? pe.Status
                : ResponseStatus.InternalServerError;

            var escaped = error.Message.Replace("\\", "\\\\").Replace("\"", "\\\"");
            var response = request.Respond()
                                  .Status(status)
                                  .Content($"{{\"error\":\"{escaped}\"}}")
                                  .Type(FlexibleContentType.Get(ContentType.ApplicationJson))
                                  .Build();
            return new ValueTask<IResponse?>(response);
        }
    }
}
