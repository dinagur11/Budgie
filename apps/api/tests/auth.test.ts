import { describe, it, expect } from "vitest";
import { anon, as, createUser, createHousehold } from "./helpers.js";

describe("authentication", () => {
  it("returns 401 on every route without credentials", async () => {
    const owner = await createUser("Owner");
    const h = await createHousehold("Home", owner);
    const calls = [
      anon().post("/households").send({ name: "X", defaultCurrency: "USD", timeZone: "UTC" }),
      anon().get(`/households/${h.id}`),
      anon().patch(`/households/${h.id}`).send({ name: "Y" }),
      anon().get(`/households/${h.id}/members`),
      anon().delete(`/households/${h.id}/members/me`),
      anon().delete(`/households/${h.id}/members/${owner.id}`),
      anon().delete(`/households/${h.id}`),
      anon().get("/me"),
      anon().get("/me/households"),
      anon().patch("/me").send({ name: "Z" }),
    ];
    for (const res of await Promise.all(calls)) {
      expect(res.status).toBe(401);
      expect(res.body).toStrictEqual({ error: expect.any(String) });
    }
    // nothing changed
    expect((await as(owner).get(`/households/${h.id}`)).status).toBe(200);
  });

  it("returns 401 for an unknown user", async () => {
    const res = await as({ id: 987654 }).get("/me");
    expect(res.status).toBe(401);
  });
});
