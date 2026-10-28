import { composeLayers } from "./overlays";
import { resolveLook, type RenderRequest, type RenderResult, type TryOnRenderer } from "./renderer";

/**
 * Local stand-in for the YouCam renderer so the gaze interface can be built and
 * demonstrated without an API key. Shapes are placed from the face landmarks but
 * it is not a real try-on; results are labelled `source: "mock"`.
 */
export class MockRenderer implements TryOnRenderer {
  readonly name = "Mock preview";

  async render(request: RenderRequest): Promise<RenderResult> {
    const imageUrl = await composeLayers(request.frame, resolveLook(request.look), request.face);
    return { imageUrl, source: "mock" };
  }
}
