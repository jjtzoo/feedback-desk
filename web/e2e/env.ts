/** Where the browser tests run; shared by playwright.config.ts and the fixtures. */
export const API = "http://localhost:8002";
export const WEB = "http://localhost:3100";

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
