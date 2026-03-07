using GenHTTP.Api.Protocol;
using GenHTTP.Modules.Functional;
using GenHTTP.Modules.IO;
using GenHTTP.Modules.Layouting.Provider;
using KROC.Server;

namespace KROC.FeatSkeleton;

/// <summary>
/// Skeleton feature module
/// </summary>
public sealed class SkeletonModule : IEndpointModule
{
  public void Register(LayoutBuilder routes)
  {
    var pong = Inline.Create()
                     .Get((IRequest request) =>
                         request.Respond()
                                .Content("pong")
                                .Type(FlexibleContentType.Get(ContentType.TextPlain))
                                .Build());

    routes.Add("pong", pong);
  }
}
