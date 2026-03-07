using System;
using System.Collections.Generic;
using System.Linq;
using GenHTTP.Api.Content;
using GenHTTP.Api.Protocol;
using GenHTTP.Modules.Functional;
using GenHTTP.Modules.Layouting;
using GenHTTP.Modules.Layouting.Provider;
using KSA;
using KROC.Server;

namespace KROC.FeatVehicleData;

public sealed class VehicleDataModule : IEndpointModule
{
    public void Register(LayoutBuilder routes)
    {
        var dataLayout = Layout.Create()
            .Add("list", Inline.Create().Get(() =>
            {
                try
                {
                    var vehicles = Universe.CurrentSystem?.Vehicles.GetList() ?? Enumerable.Empty<Vehicle>();
                    Vehicle? ctrl = Program.ControlledVehicle;

                    var items = vehicles
                        .Select(v => new VehicleListItem(v.Id, v.Id, ctrl is not null && v.Id == ctrl.Id))
                        .ToList();

                    return (object)new ApiResponse<List<VehicleListItem>>("ok", items);
                }
                catch (Exception ex)
                {
                    throw new ProviderException(ResponseStatus.InternalServerError,
                        "Unexpected error while listing vehicles.", ex);
                }
            }))
            .Add("current", Inline.Create().Get(() =>
            {
                try
                {
                    Vehicle? current = Program.ControlledVehicle;
                    if (current is null)
                        return (object)new ApiResponse<CurrentVehicleData?>("ok", null);

                    return (object)new ApiResponse<CurrentVehicleData?>("ok", new CurrentVehicleData(current.Id, current.Id, true));
                }
                catch (Exception ex)
                {
                    throw new ProviderException(ResponseStatus.InternalServerError,
                        "Unexpected error retrieving current vehicle.", ex);
                }
            }));

        routes.Add("vehicle", Layout.Create()
            .Add("data", dataLayout));
    }
}

public record VehicleListItem(string Id, string Name, bool IsControlled);
public record CurrentVehicleData(string Id, string Name, bool HasControl);
public record ApiResponse<T>(string Status, T? Data);
