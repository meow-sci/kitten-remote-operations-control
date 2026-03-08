using GenHTTP.Modules.Layouting;
using GenHTTP.Modules.Layouting.Provider;
using KROC.Server;

namespace KROC.FeatVehicleData;

public sealed class VehicleDataModule : IEndpointModule
{
    public void Register(LayoutBuilder routes)
    {
        var dataLayout = Layout.Create()
            .Add("list", GetVehicleList.Create())
            .Add("current", GetCurrentVehicle.Create());

        var actionsLayout = Layout.Create()
            .Add("ignite", ActionIgnite.Create())
            .Add("shutdown", ActionShutdown.Create())
            .Add("refill", ActionRefill.Create());

        routes.Add("vehicle", Layout.Create()
            .Add("data", dataLayout)
            .Add("actions", actionsLayout)
            .Add("telemetry", GetVehicleTelemetry.Create())); // GET /vehicle/telemetry
    }
}
