#!/usr/bin/env python3
"""Étapes 1 et 2 : extraction par domaine, puis synthèse du rapport JSON, avec un LLM local.

Le serveur doit exposer une API compatible OpenAI (/v1/chat/completions) : llama.cpp server,
Ollama, vLLM, LM Studio... La sortie est contrainte par JSON Schema (response_format).

Usage :
  python3 generate.py --snapshot snapshots/2026-10-30 --prev ../data/2026-09-30.json \
      --zone "France / Europe" --situation "urbain, appartement, famille de 4" --out report.json
Variables d'environnement :
  JANUS_ENDPOINT  (défaut http://127.0.0.1:8080/v1)
  JANUS_MODEL     (défaut local)
  JANUS_API_KEY   (optionnel ; à ne jamais commiter)
  JANUS_CTX_CHARS (défaut 24000 : taille max de texte par appel d'extraction)
Bibliothèque standard uniquement.
"""
import argparse, datetime as dt, json, os, re, sys, urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
SCHEMA = json.loads((HERE.parent / "schema.json").read_text(encoding="utf-8"))
DOMAINS = [("geo", "Géopolitique"), ("energie", "Énergie"), ("supply", "Chaînes d'appro."), ("cyber", "Cyber"),
           ("climat", "Climat"), ("sante", "Santé"), ("social", "Social & instit."), ("prep", "Préparation officielle")]
FACTS_SCHEMA = {
    "type": "object", "additionalProperties": False, "required": ["facts"],
    "properties": {"facts": {"type": "array", "maxItems": 12, "items": {
        "type": "object", "additionalProperties": False, "required": ["doc", "fact", "strength", "why"],
        "properties": {"doc": {"type": "integer", "minimum": 1}, "date": {"type": "string"},
                       "fact": {"type": "string", "maxLength": 300},
                       "strength": {"type": "string", "enum": ["fort", "faible", "bruit"]},
                       "why": {"type": "string"}}}}}}

ENDPOINT = os.environ.get("JANUS_ENDPOINT", "http://127.0.0.1:8080/v1").rstrip("/")
MODEL = os.environ.get("JANUS_MODEL", "local")
API_KEY = os.environ.get("JANUS_API_KEY", "")
CTX = int(os.environ.get("JANUS_CTX_CHARS", "24000"))


def strip_json(text):
    t = re.sub(r"^```(?:json)?|```$", "", text.strip(), flags=re.I).strip()
    a, b = t.find("{"), t.rfind("}")
    return json.loads(t[a:b + 1])


def llm(prompt, schema, name, retries=1):
    body = {"model": MODEL, "temperature": 0.2, "messages": [{"role": "user", "content": prompt}],
            "response_format": {"type": "json_schema", "json_schema": {"name": name, "strict": True, "schema": schema}}}
    headers = {"Content-Type": "application/json"}
    if API_KEY:
        headers["Authorization"] = "Bearer " + API_KEY
    last = None
    for attempt in range(retries + 1):
        req = urllib.request.Request(ENDPOINT + "/chat/completions", data=json.dumps(body).encode(), headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=1800) as r:
                content = json.loads(r.read())["choices"][0]["message"]["content"]
            return strip_json(content)
        except (ValueError, KeyError) as e:  # JSON illisible : on redemande une fois en signalant l'erreur
            last = e
            body["messages"].append({"role": "user", "content": f"Ta réponse n'était pas un JSON valide ({e}). "
                                                                "Renvoie uniquement l'objet JSON."})
    raise RuntimeError(f"{name} : échec après {retries + 1} essais ({last})")


def batches(docs, limit):
    cur, size = [], 0
    for d in docs:
        block = f'<doc n="{d["n"]}" title="{d["title"]}" publisher="{d["publisher"]}">\n{d["text"]}\n</doc>\n'
        if cur and size + len(block) > limit:
            yield "".join(cur)
            cur, size = [], 0
        cur.append(block[:limit])
        size += len(block)
    if cur:
        yield "".join(cur)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--snapshot", required=True)
    ap.add_argument("--prev", help="rapport précédent (JSON) ; omis = premier rapport")
    ap.add_argument("--zone", default="France / Europe")
    ap.add_argument("--situation", default="non précisée")
    ap.add_argument("--frequence", default="mensuel")
    ap.add_argument("--date", default=dt.date.today().isoformat())
    ap.add_argument("--period", default="")
    ap.add_argument("--out", default="report.json")
    ap.add_argument("--keep-facts", default="facts.json", help="faits intermédiaires (utile pour le test A/B)")
    a = ap.parse_args()

    snap = Path(a.snapshot)
    manifest = json.loads((snap / "manifest.json").read_text(encoding="utf-8"))
    docs = []
    for d in manifest["docs"]:
        if d.get("ok"):
            d["text"] = (snap / d["file"]).read_text(encoding="utf-8")
            docs.append(d)
    if not docs:
        sys.exit("Aucun document dans l'instantané.")
    registry = {d["n"]: d for d in docs}
    prev = json.loads(Path(a.prev).read_text(encoding="utf-8")) if a.prev else None
    period = a.period or (f"{prev['date']} → {a.date}" if prev else f"jusqu'au {a.date}")

    # Étape 1 : extraction par domaine (petits contextes = meilleure fiabilité en local)
    extract_tpl = (HERE / "prompts" / "extract.txt").read_text(encoding="utf-8")
    facts = []
    for dom_id, dom_name in DOMAINS:
        dom_docs = [d for d in docs if dom_id in d.get("domains", [])]
        dom_ns = {d["n"] for d in dom_docs}
        for chunk in batches(dom_docs, CTX):
            p = (extract_tpl.replace("{{DOMAIN}}", f"{dom_name} ({dom_id})")
                 .replace("{{PERIOD}}", period).replace("{{DOCS}}", chunk))
            out = llm(p, FACTS_SCHEMA, "facts")
            for f in out.get("facts", []):
                if f.get("doc") in dom_ns:  # on écarte tout renvoi à un document absent de ce lot
                    f["domain"] = dom_id
                    facts.append(f)
        print(f"[1/2] {dom_id} : {sum(1 for f in facts if f['domain'] == dom_id)} faits", file=sys.stderr)
    Path(a.keep_facts).write_text(json.dumps(facts, ensure_ascii=False, indent=1), encoding="utf-8")

    # Étape 2 : synthèse contrainte par schema.json
    synth_tpl = (HERE / "prompts" / "synthesize.txt").read_text(encoding="utf-8")
    config = {"zone": a.zone, "situation": a.situation, "frequence": a.frequence}
    reg_txt = "\n".join(f'[{n}] {d["title"]} — {d["publisher"]}' for n, d in sorted(registry.items()))
    kept = [f for f in facts if f["strength"] != "bruit"]
    p = (synth_tpl.replace("{{DATE}}", a.date).replace("{{CONFIG}}", json.dumps(config, ensure_ascii=False))
         .replace("{{PREV}}", json.dumps(prev, ensure_ascii=False) if prev else "aucun")
         .replace("{{REGISTRY}}", reg_txt).replace("{{FACTS}}", json.dumps(kept, ensure_ascii=False)))
    report = llm(p, SCHEMA, "report")
    print("[2/2] synthèse terminée", file=sys.stderr)

    # Post-traitement déterministe : champs fixes et sources reconstruites depuis le registre (zéro URL inventée)
    report.update(schema=1, date=a.date, period=report.get("period") or period, config=config,
                  generator=f"janus/{MODEL}")
    cited = {n for c in report.get("top_changes", []) for n in c.get("sources", [])}
    cited |= {int(n) for n in re.findall(r"\[(\d+)\]", json.dumps(report, ensure_ascii=False))}
    report["sources"] = [{k: v for k, v in {"n": n, "title": registry[n]["title"],
                                            "publisher": registry[n]["publisher"],
                                            "date": registry[n].get("fetched", "")[:10],
                                            "url": registry[n]["url"]}.items() if v}
                         for n in sorted(cited) if n in registry]
    Path(a.out).write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"Rapport écrit : {a.out} (niveau N{report['alert']['level']})")


if __name__ == "__main__":
    main()
