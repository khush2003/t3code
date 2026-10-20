import { createFileRoute } from "@tanstack/react-router";

import { AtlasWorkspace } from "../components/atlas/AtlasWorkspace";
import { validateAtlasSearch } from "../components/atlas/atlasSearch";

function AtlasRoute() {
  return <AtlasWorkspace search={Route.useSearch()} />;
}

export const Route = createFileRoute("/_chat/atlas")({
  validateSearch: validateAtlasSearch,
  component: AtlasRoute,
});
