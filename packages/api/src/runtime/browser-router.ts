import type { Hono } from "hono";
import type { Env } from "../config/bindings";

export type BrowserRouter = Hono<{ Bindings: Env; Variables: { authorizationDuration: number } }>;
