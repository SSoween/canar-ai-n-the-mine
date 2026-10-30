#!/usr/bin/env python3
"""Étape 3 : valide un rapport (Claude ou Janus) puis le publie dans data/ du dépôt.

Usage :
  python3 publish.py report.json --check-only          # valide seulement (aussi utile pour le test A/B)
  python3 publish.py report.json --repo ..              # écrit data/AAAA-MM-JJ.json + data/index.json
  python3 publish.py report.json --repo .. --git        # + git add / commit / push
Le push utilise les identifiants git déjà configurés sur la machine (clé de déploiement conseillée).
Aucun jeton dans ce script. Dépendance optionnelle : pip install jsonschema (sinon contrôles de base).
"""
import argparse, json, re, subprocess, sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
LABELS = ["VERT", "JAUNE", "ORANGE", "ROUGE", "NOIR"]
DOMAIN_IDS = {"geo", "energie", "supply", "cyber", "climat", "sante", "social", "prep"}


def validate(r, schema):
    """Renvoie (erreurs, avertissements). Une erreur bloque la publication."""
    errors, warns = [], []
    try:
        import jsonschema
        v = jsonschema.Draft7Validator(schema)
        errors += [f"schéma : {'/'.join(map(str, e.path)) or '(racine)'} : {e.message[:160]}" for e in v.iter_errors(r)]
    except ImportError:
        warns.append("jsonschema absent : contrôles de base seulement (pip install jsonschema)")
        for k in schema["required"]:
            if k not in r:
                errors.append(f"champ manquant : {k}")
    if errors:
        return errors, warns
    # Contrôles de cohérence que JSON Schema ne sait pas exprimer
    ids = [d["id"] for d in r["domains"]]
    if set(ids) != DOMAIN_IDS or len(ids) != 8:
        errors.append("domains : il faut exactement les 8 ids, sans doublon")
    if r["alert"]["label"] != LABELS[r["alert"]["level"]]:
        errors.append(f"alert : label {r['alert']['label']} incohérent avec level {r['alert']['level']}")
    sc_ids = [s["id"] for s in r["scenarios"]]
    if len(set(sc_ids)) != len(sc_ids):
        errors.append("scenarios : ids en double")
    for s in r["scenarios"]:
        for h in ("p30", "p90", "p1y"):
            p = s[h]
            if not p["lo"] <= p["v"] <= p["hi"]:
                errors.append(f"scénario {s['id']} {h} : il faut lo ≤ v ≤ hi")
        if not s["p30"]["v"] <= s["p90"]["v"] <= s["p1y"]["v"]:
            warns.append(f"scénario {s['id']} : probabilité qui baisse avec l'horizon")
    for i in r["impacts"]:
        if i["scenario_id"] not in sc_ids:
            errors.append(f"impacts : scénario inconnu {i['scenario_id']}")
    known = {s["n"] for s in r["sources"]}
    cited = {n for c in r["top_changes"] for n in c["sources"]}
    cited |= {int(n) for n in re.findall(r"\[(\d+)\]", json.dumps(r, ensure_ascii=False))}
    if cited - known:
        errors.append(f"sources citées mais absentes : {sorted(cited - known)}")
    for d in r["domains"]:
        if len(d["note"]) > 120:
            warns.append(f"domaine {d['id']} : note de {len(d['note'])} caractères (cible ≤ 120)")
    return errors, warns


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("report")
    ap.add_argument("--repo", default=str(HERE.parent))
    ap.add_argument("--check-only", action="store_true")
    ap.add_argument("--git", action="store_true")
    a = ap.parse_args()

    raw = Path(a.report).read_text(encoding="utf-8").strip()
    raw = re.sub(r"^```(?:json)?|```$", "", raw, flags=re.I).strip()
    r = json.loads(raw)
    schema = json.loads((Path(a.repo) / "schema.json").read_text(encoding="utf-8"))
    errors, warns = validate(r, schema)
    for w in warns:
        print("[avertissement]", w)
    if errors:
        for e in errors:
            print("[erreur]", e)
        sys.exit(f"Rapport refusé : {len(errors)} erreur(s).")
    print(f"Rapport valide : {r['date']} · N{r['alert']['level']} · {r.get('generator', 'inconnu')}")
    if a.check_only:
        return

    data = Path(a.repo) / "data"
    data.mkdir(exist_ok=True)
    name = f"{r['date']}.json"
    (data / name).write_text(json.dumps(r, ensure_ascii=False, indent=1), encoding="utf-8")
    idx_path = data / "index.json"
    idx = json.loads(idx_path.read_text(encoding="utf-8")) if idx_path.exists() else []
    idx = sorted({f for f in idx if not f.startswith("sample-")} | {name})
    idx_path.write_text(json.dumps(idx, indent=1), encoding="utf-8")
    print(f"Publié : data/{name} ({len(idx)} rapport(s) dans index.json)")

    if a.git:
        run = lambda *c: subprocess.run(["git", "-C", a.repo, *c], check=True)
        run("add", f"data/{name}", "data/index.json")
        run("commit", "-m", f"Rapport {r['date']} (N{r['alert']['level']}, {r.get('generator', '?')})")
        run("push")
        print("Poussé sur le dépôt.")


if __name__ == "__main__":
    main()
