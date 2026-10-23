// Фейковый Upstash REST в памяти для тестов Redis-реализации: строки, множества, хеши, ZSET, наши Lua-скрипты CAS,
// /pipeline и /multi-exec. Поддерживает только команды, которые использует приложение
import http from "node:http";

export async function startFakeUpstash() {
  const kv = new Map(), sets = new Map(), hashes = new Map(), zsets = new Map();
  const b64 = (s) => Buffer.from(s, "utf8").toString("base64");
  const enc = (v, on) => (!on ? v : typeof v === "string" ? b64(v) : Array.isArray(v) ? v.map((x) => enc(x, on)) : v);
  function run([name, ...a]) {
  switch (String(name).toUpperCase()) {
    case "SET": { const old = kv.get(a[0]) ?? null; kv.set(a[0], String(a[1])); return a.slice(2).some((x) => String(x).toUpperCase() === "GET") ? old : "OK"; }
    case "GET": return kv.get(a[0]) ?? null;
    case "EXISTS": return a.filter((k) => kv.has(k) || hashes.has(k)).length;
    case "DEL": { let n = 0; for (const k of a) n += +kv.delete(k) + +hashes.delete(k) + +zsets.delete(k); return n; }
    case "MGET": return a.map((k) => kv.get(k) ?? null);
    case "SADD": { const s = sets.get(a[0]) ?? new Set(); const n = s.size; a.slice(1).forEach((m) => s.add(m)); sets.set(a[0], s); return s.size - n; }
    case "SMEMBERS": return [...(sets.get(a[0]) ?? [])];
    case "HSET": { const h = hashes.get(a[0]) ?? new Map(); let n = 0; for (let i = 1; i < a.length; i += 2) { n += h.has(a[i]) ? 0 : 1; h.set(a[i], String(a[i + 1])); } hashes.set(a[0], h); return n; }
    case "HSETNX": { const h = hashes.get(a[0]) ?? new Map(); if (h.has(a[1])) return 0; h.set(a[1], String(a[2])); hashes.set(a[0], h); return 1; }
    case "ZADD": { const z = zsets.get(a[0]) ?? []; for (let i = 1; i < a.length; i += 2) z.push([Number(a[i]), String(a[i + 1])]); z.sort((x, y) => x[0] - y[0]); zsets.set(a[0], z); return (a.length - 1) / 2; }
    case "ZRANGE": return (zsets.get(a[0]) ?? []).map((x) => x[1]);
    case "ZCARD": return (zsets.get(a[0]) ?? []).length;
    case "SCAN": {
      // Один проход: курсор сразу 0. MATCH — glob с *
      const i = a.findIndex((x) => String(x).toUpperCase() === "MATCH");
      const re = new RegExp("^" + String(i >= 0 ? a[i + 1] : "*").split("*").map((x) => x.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$");
      return ["0", [...new Set([...kv.keys(), ...sets.keys(), ...hashes.keys(), ...zsets.keys()])].filter((k) => re.test(k))];
    }
    case "HLEN": return hashes.get(a[0])?.size ?? 0;
    case "INCR": { const v = Number(kv.get(a[0]) ?? 0) + 1; kv.set(a[0], String(v)); return v; }
    case "EXPIRE": return 1;
    case "HGET": return hashes.get(a[0])?.get(a[1]) ?? null;
    case "HDEL": { const h = hashes.get(a[0]); let n = 0; for (const f of a.slice(1)) n += h?.delete(f) ? 1 : 0; return n; }
    case "HGETALL": { const h = hashes.get(a[0]); return h ? [...h].flat() : []; }
    case "EVAL": {
      if (String(a[0]).includes("ZCARD")) {
        // CAS полей хешей приложения (lib/redis.ts HASH_CAS_SCRIPT)
        const nk = Number(a[1]); const keys = a.slice(2, 2 + nk); const argv = a.slice(2 + nk); const n = Number(argv[0]);
        const ver = (k, f) => { const c = hashes.get(k)?.get(f); if (c === undefined) return -1; try { return Number(JSON.parse(c).version ?? 0); } catch { return 0; } };
        for (let i = 0; i < n; i++) { const b = 1 + i * 4; if (ver(keys[i], argv[b]) !== Number(argv[b + 1])) return [0, i + 1]; }
        const z = 1 + n * 4;
        if (keys.length > n && (zsets.get(keys[n]) ?? []).length !== Number(argv[z + 2])) return [0, 0];
        for (let i = 0; i < n; i++) { const b = 1 + i * 4; if (argv[b + 2] === "set") run(["HSET", keys[i], argv[b], argv[b + 3]]); else if (argv[b + 2] === "del") run(["HDEL", keys[i], argv[b]]); }
        if (keys.length > n) run(["ZADD", keys[n], argv[z], argv[z + 1]]);
        return [1, n];
      }
      // Только CAS-скрипт приложения: сравнить version, записать при совпадении
      const [, nkeys, key, expected, body] = a;
      if (!String(a[0]).includes("cjson.decode") || Number(nkeys) !== 1) throw new Error("unsupported script");
      const cur = kv.get(key); let v = 0;
      if (cur) { try { v = Number(JSON.parse(cur).version ?? 0); } catch {} }
      if (v !== Number(expected)) return [0, v];
      kv.set(key, String(body)); return [1, v + 1];
    }
    default: throw new Error("unsupported " + name);
  }
}
  const server = http.createServer(async (req, res) => {
    let body = "";
    for await (const c of req) body += c;
    const on = req.headers["upstash-encoding"] === "base64";
    const path = req.url.replace(/^\//, "") || "single";
    const cmds = path === "single" ? [JSON.parse(body)] : JSON.parse(body);
    const results = cmds.map((c) => { try { return { result: enc(run(c), on) }; } catch (e) { return { error: e.message }; } });
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(path === "single" ? results[0] : results));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    reset: () => [kv, sets, hashes, zsets].forEach((m) => m.clear()),
    close: () => new Promise((r) => server.close(r)),
  };
}
