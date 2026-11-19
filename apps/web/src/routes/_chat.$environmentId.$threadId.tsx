import { createFileRoute } from "@tanstack/react-router";

import { parseBotSearch } from "../components/bots/botView";

// The _chat layout owns ChatView so draft promotion keeps it mounted.
export const Route = createFileRoute("/_chat/$environmentId/$threadId")({
  validateSearch: parseBotSearch,
  component: () => null,
});
