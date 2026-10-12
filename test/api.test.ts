import { afterAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/server";
import { seededDb, users } from "./helpers";

const app = buildApp(seededDb());
afterAll(() => app.close());

const get = (url: string) => app.inject({ method: "GET", url });

describe("GET /users/:id/recommendations", () => {
  it("returns a ranked list with an explanation for each Circle", async () => {
    const res = await get("/users/7/recommendations");
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.user_id).toBe(7);
    expect(body.recommendations).toHaveLength(5);
    expect(body.recommendations[0]).toEqual({
      circle: {
        id: 5,
        name: "Women Who Lead",
        description: "A supportive circle for women focused on leadership skills.",
        topic: "Leadership skills",
        format: "hybrid",
        join_policy: "open",
        member_count: 24,
        seats_left: 7,
      },
      score: expect.any(Number),
      reasons: [
        { code: "topic_match", text: expect.any(String) },
        { code: "active", text: expect.any(String) },
      ],
      explanation: expect.stringContaining("leadership skills"),
    });
  });

  it("returns the same shape for every user", async () => {
    for (const u of users) {
      const res = await get(`/users/${u.id}/recommendations`);
      expect(res.statusCode, `user ${u.id}`).toBe(200);
      for (const r of res.json().recommendations) {
        expect(Object.keys(r).sort()).toEqual(["circle", "explanation", "reasons", "score"]);
        expect(Object.keys(r.circle).sort()).toEqual([
          "description", "format", "id", "join_policy", "member_count", "name", "seats_left", "topic",
        ]);
        expect(typeof r.explanation).toBe("string");
      }
    }
  });

  it("honors limit", async () => {
    expect((await get("/users/7/recommendations?limit=1")).json().recommendations).toHaveLength(1);
    expect((await get("/users/7/recommendations?limit=12")).json().recommendations).toHaveLength(12);
  });

  it("returns 404 for an unknown user", async () => {
    const res = await get("/users/9999/recommendations");
    expect(res.statusCode).toBe(404);
    expect(res.json().message).toBe("User 9999 not found");
  });

  it("returns 400 for a malformed user id", async () => {
    for (const id of ["abc", "0", "-3", "1.5"]) {
      expect((await get(`/users/${id}/recommendations`)).statusCode, id).toBe(400);
    }
  });

  it("returns 400 for a limit that is out of range or not a number", async () => {
    for (const limit of ["0", "-1", "21", "many"]) {
      expect((await get(`/users/7/recommendations?limit=${limit}`)).statusCode, limit).toBe(400);
    }
  });
});

describe("GET /health", () => {
  it("reports ok", async () => {
    expect((await get("/health")).json()).toEqual({ status: "ok" });
  });
});
