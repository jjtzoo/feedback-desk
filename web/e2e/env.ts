/**
 * Where the browser tests run; shared by playwright.config.ts and the fixtures. E2E_API_PORT,
 * E2E_WEB_PORT and E2E_CONTROL_PORT move them (with E2E_DATABASE for the API), so a second worktree
 * or a shard (e2e/shards.mjs) runs its own servers.
 */
export const API_PORT = process.env.E2E_API_PORT ?? "8002";
export const WEB_PORT = process.env.E2E_WEB_PORT ?? "3100";
export const API = `http://localhost:${API_PORT}`;
export const WEB = `http://localhost:${WEB_PORT}`;
/** The test API's supervisor (backend/scripts/e2e_server.py), which restarts it with another model. */
export const API_CONTROL = `http://127.0.0.1:${process.env.E2E_CONTROL_PORT ?? "8012"}`;

/** The first-visit tour is switched off for every test except the ones about the tour itself. */
export const TOUR_SEEN = {
  cookies: [],
  origins: [
    {
      origin: WEB,
      localStorage: ["staff", "console"].map((area) => ({ name: `feedback-guide-seen:${area}:v2`, value: "1" })),
    },
  ],
};

/** A browser that has never been here: the tour opens by itself. */
export const FIRST_VISIT = { cookies: [], origins: [] };
