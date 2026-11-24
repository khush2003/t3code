import { createFileRoute } from "@tanstack/react-router";

import { BotSpace } from "../components/bots/space/BotSpace";

export const Route = createFileRoute("/_chat/space")({ component: BotSpace });
