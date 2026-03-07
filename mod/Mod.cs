using System;
using System.Collections.Generic;
using System.IO;
using Brutal.Numerics;
using Brutal.ImGuiApi;
using StarMap.API;
using KSA;
using KROC.Server;
using KROC.FeatPing;
using KROC.FeatVehicleData;

namespace KROC;

[StarMapMod]
public class Mod
{
  public bool ImmediateUnload => false;

  private bool _isInitialized = false;
  private bool _isDisposed = false;
  private bool _windowVisible = false;
  private KrocServer? _server;


  [StarMapImmediateLoad]
  public void OnImmediateLoad() { }

  [StarMapAllModsLoaded]
  public void OnFullyLoaded()
  {
    try
    {
      Patcher.Patch();
      var config = KrocServerConfig.LoadFromToml(GetConfigPath());
      _server = new KrocServer(config, new List<IEndpointModule>
      {
        new PingModule(),
        new VehicleDataModule()
      });
      _ = _server.StartAsync();
      _isInitialized = true;
    }
    catch (Exception ex)
    {
      Console.WriteLine($"kititen-remote-operations-control: Error during initialization: {ex.Message}");
    }
  }

  [StarMapBeforeGui]
  public void OnBeforeUi(double dt) { }

  [StarMapAfterGui]
  public void OnAfterUi(double dt)
  {
    try
    {
      if (!_isInitialized || _isDisposed) return;

      if (ImGui.IsKeyPressed(ImGuiKey.F11))
        _windowVisible = !_windowVisible;

      if (_windowVisible)
        RenderWindow();
    }
    catch (Exception ex)
    {
      Console.WriteLine($"kititen-remote-operations-control: Error in OnAfterUi: {ex.Message}");
    }
  }

  [StarMapUnload]
  public void Unload()
  {
    try
    {
      Patcher.Unload();
      if (_server != null)
      {
        try { _server.StopAsync().GetAwaiter().GetResult(); }
        catch (Exception stopEx) { Console.WriteLine($"KROC: error stopping server: {stopEx.Message}"); }
      }
      _isDisposed = true;
    }
    catch (Exception ex)
    {
      Console.WriteLine($"kititen-remote-operations-control: Error during unload: {ex.Message}");
    }
  }

  private void RenderWindow()
  {
    // Set initial window size
    ImGui.SetNextWindowSize(new float2(600, 800), ImGuiCond.FirstUseEver);

    // Begin window
    if (ImGui.Begin("kititen-remote-operations-control Mod", ref _windowVisible))
    {
      // Header
      ImGui.TextColored(new float4(0.0f, 1.0f, 0.0f, 1.0f), "kititen-remote-operations-control");
      ImGui.Separator();

      // Zoom Out Animation Configuration
      if (ImGui.CollapsingHeader("thing", ImGuiTreeNodeFlags.DefaultOpen))
      {
        ImGui.Indent();
        
        if (ImGui.Button("press me"))
        {
          Console.WriteLine("button pressed!");
        }
        
        ImGui.Unindent();
      }
      
      // Close button
      if (ImGui.Button("Close"))
      {
        _windowVisible = false;
      }
    }
    ImGui.End();
  }

  private static string GetConfigPath()
  {
    var myDocuments = Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments);
    return Path.Combine(myDocuments, "My Games", "Kitten Space Agency", "kroc.toml");
  }
}

