using GenHTTP.Modules.Layouting;
using GenHTTP.Modules.Layouting.Provider;
using KROC.Server;

namespace KROC.FeatFlightComputer;

public sealed class FlightComputerModule : IEndpointModule
{
    public void Register(LayoutBuilder routes)
    {
        routes.Add("flight-computer", Layout.Create()
            .Add("state", GetFlightComputerState.Create())
            .Add("attitude", SetAttitude.Create())
            .Add("track", SetTrackTarget.Create()));
    }
}
