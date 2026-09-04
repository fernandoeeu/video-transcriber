import { createServerFn } from "@tanstack/react-start";
import { checkDependencies } from "../core/dependencies";
import { createProcessRunner } from "../core/process-runner";

const runner = createProcessRunner();

// Resolve project root relative to this file (apps/web/src/server -> project root)
const PROJECT_ROOT = new URL("../../../../", import.meta.url).pathname.replace(/\/$/, "");

export const getDependencies = createServerFn({ method: "GET" }).handler(async () => {
  return checkDependencies(runner, PROJECT_ROOT);
});
