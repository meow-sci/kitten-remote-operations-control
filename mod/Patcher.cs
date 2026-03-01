using System;
using HarmonyLib;
using Brutal.Numerics;
using KSA;

namespace KROC;

[HarmonyPatch]
internal static class Patcher
{
    private static Harmony? _harmony = new Harmony("kititen-remote-operations-control");

    public static void Patch()
    {
        try
        {
            _harmony?.PatchAll(typeof(Patcher).Assembly);
        }
        catch (Exception ex)
        {
            Console.WriteLine($"kititen-remote-operations-control: Error applying patches: {ex.Message}");
        }
    }

    public static void Unload()
    {
        try
        {
            _harmony?.UnpatchAll("kititen-remote-operations-control");
            _harmony = null;
        }
        catch (Exception ex)
        {
            Console.WriteLine($"kititen-remote-operations-control: Error removing patches: {ex.Message}");
        }
    }

}
