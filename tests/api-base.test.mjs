import assert from "node:assert/strict";
import test from "node:test";

import { resolveApiBase } from "../src/shared/api-base.js";

test("resolveApiBase honors an explicit configured base first", () => {
  assert.equal(
    resolveApiBase({
      dataset: { apiBase: "https://api.example.test///" },
      datasetKeys: ["apiBase"],
      hostname: "localhost",
    }),
    "https://api.example.test",
  );
});

test("resolveApiBase supports auth-base and api-base dataset names", () => {
  assert.equal(
    resolveApiBase({
      dataset: { apiBase: "", authBase: "https://auth.example.test/" },
      datasetKeys: ["apiBase", "authBase"],
      hostname: "gvdgclub.com",
    }),
    "https://auth.example.test",
  );
});

test("resolveApiBase maps known hosts to the correct Worker", () => {
  assert.equal(resolveApiBase({ dataset: {}, hostname: "localhost" }), "http://127.0.0.1:8788");
  assert.equal(resolveApiBase({ dataset: {}, hostname: "127.0.0.1" }), "http://127.0.0.1:8788");
  assert.equal(resolveApiBase({ dataset: {}, hostname: "greenvillediscgolf.com" }), "https://auth.greenvillediscgolf.com");
  assert.equal(resolveApiBase({ dataset: {}, hostname: "www.greenvillediscgolf.com" }), "https://auth.greenvillediscgolf.com");
  assert.equal(resolveApiBase({ dataset: {}, hostname: "gvdgclub.com" }), "https://auth.gvdgclub.com");
});
