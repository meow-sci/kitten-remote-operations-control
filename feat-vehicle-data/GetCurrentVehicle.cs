using System;
using GenHTTP.Api.Content;
using GenHTTP.Api.Protocol;
using GenHTTP.Modules.Functional;
using KSA;

namespace KROC.FeatVehicleData;

public static class GetCurrentVehicle
{
    public static IHandler Create()
    {
        return Inline.Create()
            .Get(() =>
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
        })
            .Build();
    }
}
