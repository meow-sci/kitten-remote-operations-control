using GenHTTP.Api.Protocol;
using GenHTTP.Modules.Functional;
using GenHTTP.Modules.IO;
using GenHTTP.Modules.Layouting.Provider;
using KROC.Server;

namespace KROC.FeatVehicleData;

/// <summary>
/// VehicleData feature module
/// </summary>
public sealed class VehicleDataModule : IEndpointModule
{
  public void Register(LayoutBuilder routes)
  {
    var pong = Inline.Create()
                     .Get((IRequest request) =>
                         request.Respond()
                                .Content("pong")
                                .Type(FlexibleContentType.Get(ContentType.TextPlain))
                                .Build());

    routes.Add("pongz", pong);
  }
}
