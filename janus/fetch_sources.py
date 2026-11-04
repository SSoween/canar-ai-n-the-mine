#!/usr/bin/env python3
"""Étape 0 : fige les sources validées dans un instantané daté (texte brut).

Usage : python3 fetch_sources.py --sources sources.json --out snapshots
Crée snapshots/AAAA-MM-JJ/ avec un fichier texte par source et un manifest.json.
L'instantané est réutilisable tel quel pour le test A/B (mêmes entrées pour Claude et Janus).
Bibliothèque standard uniquement.
"""
import argparse, datetime as dt, html, json, re, sys, urllib.request
from html.parser import HTMLParser
from pathlib import Path

MAX_CHARS = 40000  # par document, pour borner la taille des instantanés


class TextExtractor(HTMLParser):
    SKIP = {"script", "style", "nav", "footer", "header", "noscript", "svg", "form"}

    def __init__(self):
        super().__init__()
        self.parts, self.depth = [], 0

    def handle_starttag(self, tag, attrs):
        if tag in self.SKIP:
            self.depth += 1
        elif tag in {"p", "br", "li", "h1", "h2", "h3", "h4", "tr", "div"}:
            self.parts.append("\n")

    def handle_endtag(self, tag):
        if tag in self.SKIP and self.depth:
            self.depth -= 1

    def handle_data(self, data):
        if not self.depth:
            self.parts.append(data)


def html_to_text(raw):
    p = TextExtractor()
    p.feed(raw)
    txt = "".join(p.parts)
    return re.sub(r"\n\s*\n+", "\n\n", re.sub(r"[ \t]+", " ", txt)).strip()


def feed_to_text(raw):
    items = re.findall(r"<(item|entry)\b.*?</\1>", raw, flags=re.S | re.I)
    out = []
    for m in re.finditer(r"<(item|entry)\b(.*?)</\1>", raw, flags=re.S | re.I):
        block = m.group(2)
        get = lambda t: (re.search(rf"<{t}[^>]*>(.*?)</{t}>", block, re.S | re.I) or [None, ""])[1]
        title, date = get("title"), get("pubDate") or get("updated") or get("published")
        desc = get("description") or get("summary") or get("content")
        desc = html_to_text(html.unescape(re.sub(r"<!\[CDATA\[|\]\]>", "", desc)))
        title = html.unescape(re.sub(r"<!\[CDATA\[|\]\]>", "", title)).strip()
        out.append(f"- [{date.strip()}] {title}\n  {desc[:800]}")
    return "\n".join(out) if items else ""


def fetch(url):
    if not url.startswith("https://"):
        raise ValueError("https uniquement")
    req = urllib.request.Request(url, headers={"User-Agent": "canar-ai-n-the-mine/1.0 (veille personnelle)"})
    with urllib.request.urlopen(req, timeout=30) as r:
        ctype = r.headers.get("Content-Type", "")
        raw = r.read(5_000_000).decode(r.headers.get_content_charset() or "utf-8", errors="replace")
    if "xml" in ctype or raw.lstrip().startswith("<?xml") or "<rss" in raw[:500]:
        return feed_to_text(raw) or html_to_text(raw)
    return html_to_text(raw)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sources", default="sources.json")
    ap.add_argument("--out", default="snapshots")
    ap.add_argument("--date", default=dt.date.today().isoformat())
    a = ap.parse_args()

    cfg = json.loads(Path(a.sources).read_text(encoding="utf-8"))
    snap = Path(a.out) / a.date
    snap.mkdir(parents=True, exist_ok=True)
    docs, ok = [], 0
    for n, s in enumerate(cfg["sources"], start=1):
        entry = {"n": n, "id": s["id"], "title": s.get("title", s["id"]), "publisher": s.get("publisher", ""),
                 "url": s["url"], "domains": s.get("domains", []), "file": f"{s['id']}.txt", "ok": False}
        try:
            text = fetch(s["url"])[:MAX_CHARS]
            (snap / entry["file"]).write_text(text, encoding="utf-8")
            entry.update(ok=True, chars=len(text), fetched=dt.datetime.now().isoformat(timespec="seconds"))
            ok += 1
        except Exception as e:  # une source en échec ne bloque pas les autres
            entry["error"] = str(e)[:200]
            print(f"[warn] {s['id']} : {e}", file=sys.stderr)
        docs.append(entry)
    (snap / "manifest.json").write_text(json.dumps({"date": a.date, "docs": docs}, ensure_ascii=False, indent=1),
                                        encoding="utf-8")
    print(f"Instantané {snap} : {ok}/{len(docs)} sources récupérées")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
