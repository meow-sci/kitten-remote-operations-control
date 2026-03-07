using System;
using System.Collections.Generic;
using System.Linq;
using GenHTTP.Api.Content;
using GenHTTP.Api.Protocol;
using GenHTTP.Modules.Functional;
using KSA;

namespace KROC.FeatVehicleData;

public static class GetVehicleList
{
    public static IHandler Create()
    {
        return Inline.Create()
            .Get(() =>
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
        })
            .Build();
    }
}
