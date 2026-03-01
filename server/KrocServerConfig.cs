using System;
using System.IO;
using Tomlyn;
using Tomlyn.Model;

namespace KROC.Server;

/// <summary>Configuration for the KROC remote operations server.</summary>
public sealed class KrocServerConfig
{
    /// <summary>Hostname or IP to bind to. Default: 0.0.0.0.</summary>
    public string BindHost { get; init; } = "0.0.0.0";

    /// <summary>Port to listen on. Default: 7887.</summary>
    public int Port { get; init; } = 7887;

    /// <summary>When false the server is not started. Default: true.</summary>
    public bool Enabled { get; init; } = true;

    /// <summary>
    /// Loads configuration from a TOML file at <paramref name="tomlPath"/>.
    /// If the file does not exist, a default config file is written and default values are used.
    /// </summary>
    /// <param name="tomlPath">Absolute or relative path to the TOML config file.</param>
    /// <returns>A <see cref="KrocServerConfig"/> populated from the file.</returns>
    public static KrocServerConfig LoadFromToml(string tomlPath)
    {
        if (!File.Exists(tomlPath))
        {
            WriteDefaultToml(tomlPath);
            return new KrocServerConfig();
        }

        string text = File.ReadAllText(tomlPath);

        TomlTable table;
        try
        {
            table = Toml.ToModel(text);
            if (table is null)
                throw new InvalidOperationException("Parsed table was null.");
        }
        catch (Exception ex) when (ex is not InvalidOperationException)
        {
            throw new InvalidOperationException(
                $"KROC: failed to parse config file '{tomlPath}': {ex.Message}", ex);
        }

        string bindHost = "0.0.0.0";
        if (table.TryGetValue("server_bind_host", out object? hostVal) && hostVal is string hostStr)
            bindHost = hostStr;

        int port = 7887;
        if (table.TryGetValue("server_port", out object? portVal) && portVal is long portLong)
            port = (int)portLong;

        bool enabled = true;
        if (table.TryGetValue("server_enabled", out object? enabledVal) && enabledVal is bool enabledBool)
            enabled = enabledBool;

        return new KrocServerConfig
        {
            BindHost = bindHost,
            Port = port,
            Enabled = enabled,
        };
    }

    private static void WriteDefaultToml(string tomlPath)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(tomlPath)!);
        File.WriteAllText(tomlPath,
            "# kitten remote operations control — server config\n" +
            "server_bind_host = \"0.0.0.0\"\n" +
            "server_port = 7887\n" +
            "server_enabled = true\n");
        Console.WriteLine($"KROC: wrote default server config to {tomlPath}");
    }
}
