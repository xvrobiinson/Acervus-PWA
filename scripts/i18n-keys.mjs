// Lists every English text the app passes to t(en, es), as the translation
// catalog (src/lib/translations.json) keys it: ${...} becomes {0}, {1}...
// The landing page and legal pages stay English and Spanish for now.
//
// Usage: node scripts/i18n-keys.mjs           prints texts missing from the catalog
//        node scripts/i18n-keys.mjs --all     prints them all

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

function walk(d, out = []) {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(f) && !/test/.test(f) && !/landing|legal/.test(f)) out.push(p);
  }
  return out;
}

/** Reads a string or template literal starting at s[i]; null if it isn't one. */
function literal(s, i) {
  const q = s[i];
  if (q !== '"' && q !== "`" && q !== "'") return null;
  let out = "";
  let n = 0;
  for (let j = i + 1; j < s.length; j++) {
    const c = s[j];
    if (c === "\\") {
      const e = s[++j];
      out += e === "n" ? "\n" : e;
    } else if (c === q) {
      return { text: out, end: j + 1 };
    } else if (q === "`" && c === "$" && s[j + 1] === "{") {
      let depth = 1;
      j += 2;
      while (depth > 0) {
        if (s[j] === "{") depth++;
        else if (s[j] === "}") depth--;
        j++;
      }
      j--;
      out += `{${n++}}`;
    } else out += c;
  }
  return null;
}

export function keys() {
  const found = new Set();
  for (const f of walk("src").concat(walk("shared"))) {
    const s = readFileSync(f, "utf8");
    // t("..", ..) and the [en, es] pairs passed on as data.
    for (const m of s.matchAll(/(?:\bt\(\s*|\[\s*|\ben: |, )(?=["`])/g)) {
      const at = m.index + m[0].length;
      const a = literal(s, at);
      if (!a) continue;
      const isCall = /t\(/.test(m[0]);
      const next = /^\s*,\s*(?:es: )?(["`])/.test(s.slice(a.end, a.end + 80));
      if (isCall ? /^\s*,/.test(s.slice(a.end, a.end + 20)) : next && /[A-Za-z]/.test(a.text) && /^[A-Z“]/.test(a.text)) found.add(a.text);
    }
  }
  return [...found].sort();
}

if (process.argv[1]?.endsWith("i18n-keys.mjs")) {
  const catalog = JSON.parse(readFileSync("src/lib/translations.json", "utf8"));
  const all = process.argv.includes("--all");
  const list = keys().filter((k) => all || !catalog[k]);
  console.log(JSON.stringify(list, null, 0).replace(/","/g, '",\n"'));
  console.error(`${list.length} texts`);
}
