import { createFileRoute, redirect } from "@tanstack/react-router";

import { validateAnimaSearch } from "../components/anima/anima.logic";

// Anima moved out of Settings; old links and bookmarks land on its page.
export const Route = createFileRoute("/_chat/settings/anima")({
  validateSearch: validateAnimaSearch,
  beforeLoad: ({ search }) => {
    throw redirect({ to: "/anima", search, replace: true });
  },
});
