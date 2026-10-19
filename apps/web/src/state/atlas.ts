import { createAtlasEnvironmentAtoms } from "@t3tools/client-runtime/state/atlas";

import { connectionAtomRuntime } from "../connection/runtime";

export const atlasEnvironment = createAtlasEnvironmentAtoms(connectionAtomRuntime);
