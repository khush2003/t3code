import { createFileRoute } from "@tanstack/react-router";

import { AnimaPage } from "../components/anima/AnimaPage";
import { validateAnimaSearch } from "../components/anima/anima.logic";

function AnimaRoute() {
  const target = Route.useSearch();
  return <AnimaPage {...target} />;
}

export const Route = createFileRoute("/_chat/anima")({
  validateSearch: validateAnimaSearch,
  component: AnimaRoute,
});
