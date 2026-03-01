using System;
using System.Collections.Generic;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;

namespace KROC.Server;

/// <summary>Minimal ASP.NET Core server that hosts KROC endpoint modules.</summary>
public sealed class KrocServer
{
    private readonly KrocServerConfig _config;
    private readonly IReadOnlyList<IEndpointModule> _modules;
    private WebApplication? _app;

    public KrocServer(KrocServerConfig config, IReadOnlyList<IEndpointModule> modules)
    {
        _config = config;
        _modules = modules;
    }

    public async Task StartAsync(CancellationToken ct = default)
    {
        if (!_config.Enabled)
        {
            Console.WriteLine("KROC: server is disabled, not starting.");
            return;
        }

        var builder = WebApplication.CreateSlimBuilder();

        builder.Services.ConfigureHttpJsonOptions(opts =>
        {
            opts.SerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.CamelCase;
            opts.SerializerOptions.DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull;
        });

        var app = builder.Build();
        app.Urls.Add($"http://{_config.BindHost}:{_config.Port}");

        app.Use(async (context, next) =>
        {
            context.Response.Headers["Access-Control-Allow-Origin"] = "*";
            context.Response.Headers["Access-Control-Allow-Headers"] = "*";
            context.Response.Headers["Access-Control-Allow-Methods"] = "*";
            if (HttpMethods.IsOptions(context.Request.Method))
            {
                context.Response.StatusCode = 200;
                return;
            }
            await next(context);
        });

        app.Use(async (context, next) =>
        {
            try
            {
                await next(context);
            }
            catch (Exception ex)
            {
                Console.WriteLine($"KROC: unhandled exception in request: {ex}");
                context.Response.StatusCode = 500;
                context.Response.ContentType = "application/json";
                await context.Response.WriteAsync($"{{\"error\":\"{ex.Message}\"}}");
            }
        });

        app.MapGet("/ping", () => Results.Ok(new { status = "ok" }));

        foreach (var module in _modules)
            module.Register(app);

        await app.StartAsync(ct);
        _app = app;
    }

    public async Task StopAsync(CancellationToken ct = default)
    {
        if (_app is null)
            return;

        await _app.StopAsync(ct);
        await _app.DisposeAsync();
        _app = null;
    }
}
