# canar-ai-n-the-mine

Early-warning watch for systemic risks. Alert level, what changed since last time, no doom. A tiny offline PWA.

Une PWA statique qui lit des rapports de veille au format JSON (`schema.json`) et calcule seule les
variations (▲ ▼ ► 🆕) et les « = IDEM ». Les rapports peuvent venir de **Claude** (copier-coller) ou de
**Janus** (génération locale, commit automatique). Il n'y a ni serveur ni clé API dans l'app.

## Structure
```
index.html · style.css · app.js · manifest.webmanifest · sw.js · icons/   → la PWA
schema.json                                                             → format de référence (Claude, Janus, PWA)
prompt-json.md                                                          → prompt version Claude
data/index.json + data/AAAA-MM-JJ.json                                  → rapports publiés (lus par la PWA)
data/sample-*.json                                                      → exemple fictif (menu ⋯)
janus/                                                                  → chaîne de génération locale
  sources.example.json   liste de sources validées (à copier en sources.json)
  fetch_sources.py       étape 0 : instantané daté des sources (texte brut)
  prompts/extract.txt    étape 1 : extraction des faits par domaine
  prompts/synthesize.txt étape 2 : synthèse du rapport
  generate.py            étapes 1 et 2 via une API compatible OpenAI, sortie contrainte par schema.json
  publish.py             étape 3 : validation + data/ + index.json (+ git push)
  run.sh                 chaîne complète, planifiable en cron
```

## Déployer la PWA (GitHub Pages)
1. Dépose tout le dossier à la racine du dépôt `canar-ai-n-the-mine`.
2. Settings → Pages → Source : branche `main`, dossier `/ (root)`.
3. Ouvre `https://<compte>.github.io/canar-ai-n-the-mine/` sur le téléphone.
4. Installer : Android/Chrome → ⋮ → « Installer l'application » ; iPhone/Safari → Partager → « Sur l'écran d'accueil ».

Après toute modification de l'app, incrémente `VERSION` dans `sw.js`.

## Option 1 : Claude (manuel)
PWA ⋯ → « Copier ce rapport » → app Claude avec `prompt-json.md` → copier le JSON → PWA ＋ → Ajouter.
Pour l'archiver dans le dépôt : `python3 janus/publish.py rapport.json --git`.

## Option 2 : Janus (automatique)
Prérequis sur Janus : Python 3.9+, un serveur LLM local avec une API compatible OpenAI et la prise en
charge de `response_format` JSON Schema (llama.cpp server, Ollama récent, vLLM…), un clone du dépôt
avec un accès en écriture (clé de déploiement limitée à ce dépôt), et en option `pip install jsonschema`.

```bash
cd janus
cp sources.example.json sources.json          # puis mets TES sources validées
export JANUS_ENDPOINT=http://127.0.0.1:8080/v1 JANUS_MODEL=<ton-modèle>
export ZONE="France / Europe" SITUATION="urbain, appartement, famille de 4"
./run.sh                                       # test manuel, puis cron (voir en-tête de run.sh)
```

Garde-fous intégrés :
- **Faits :** chaque fait doit renvoyer à un document de l'instantané. Les renvois inexistants sont écartés.
- **Sources :** elles sont reconstruites depuis `sources.json`, jamais écrites par le modèle. Aucune URL ne peut être inventée.
- **Validation :** `publish.py` refuse de publier un rapport non conforme (schéma, 8 domaines, lo ≤ v ≤ hi, sources citées existantes).
- **Injection :** le contenu des pages est traité comme des données ; les prompts demandent d'ignorer toute instruction qu'il contiendrait.

## Test A/B Claude vs Janus
1. Lance `fetch_sources.py` une fois, puis garde l'instantané `janus/snapshots/<date>/` comme entrée commune.
2. Janus : `generate.py --snapshot …` (les faits intermédiaires sont gardés dans `facts.json`).
3. Claude : `prompt-json.md` en mode « documents fournis » avec le même instantané.
4. Vérifie les deux avec `publish.py --check-only`, puis compare-les à l'aveugle (A/B).

## Confidentialité
- **Dépôt public :** la « situation personnelle » contenue dans les rapports devient publique. Préfère un dépôt privé ou une configuration générique.
- **Secrets :** ne commite jamais de clé, de jeton ni de `JANUS_API_KEY`. Ajoute `janus/snapshots/` et `janus/out/` au `.gitignore` si tu ne veux pas les publier.
