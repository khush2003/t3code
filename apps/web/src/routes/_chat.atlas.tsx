import { createFileRoute } from "@tanstack/react-router";

import { AtlasWorkspace } from "../components/atlas/AtlasWorkspace";

export const Route = createFileRoute("/_chat/atlas")({
  component: AtlasWorkspace,
});
