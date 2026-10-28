import { createFileRoute } from "@tanstack/react-router";

import { AnimaSettings } from "../components/settings/AnimaSettings";
import { validateAnimaSearch } from "../components/settings/animaSettings.logic";

function SettingsAnimaRoute() {
  const target = Route.useSearch();
  return <AnimaSettings {...target} />;
}

export const Route = createFileRoute("/_chat/settings/anima")({
  validateSearch: validateAnimaSearch,
  component: SettingsAnimaRoute,
});
