# canar-ai-n-the-mine

Early-warning watch for systemic risks. Alert level, what changed since last time, no doom. A tiny offline PWA, fed by a local AI.

🇬🇧 [English](#english) · 🇫🇷 [Français](#français)

---

## English

### What it is
A **daily** risk report generated **entirely on your own hardware** by a local LLM, and read on your phone through a small offline PWA.
The PWA computes on its own what moved since last time (▲ ▼ ► 🆕) and collapses what didn't (« = IDEM »), so you only read what changed.
The project has no cloud AI and no API key, and your data stays with you.

### How it works
```
sources.json ──► fetch_sources.py ──► generate.py (local LLM) ──► publish.py ──► data/ ──► PWA
  your list        dated snapshot      1. extract facts             validate        GitHub    phone
                   (plain text)        2. write the report          + git push      Pages
```
1. **Snapshot**: every source is downloaded once and frozen as plain text in a dated folder.
2. **Extraction** (`prompts/extract.txt`): domain by domain, the model lists facts found in the documents, each tied to its source number and rated *strong*, *weak* or *noise*.
3. **Synthesis** (`prompts/synthesize.txt`): the model compares those facts with the previous report and writes the new one. Its output is forced to match `schema.json`.
4. **Publication**: the report is validated (schema and consistency checks) and then committed to `data/`. The PWA picks it up at launch.

The report covers 8 domains: geopolitics, energy, supply chains, cyber, climate, health, social, and official preparedness signals.
It uses a 5-level alert scale: N0 green to N4 black.

### Built-in safeguards
- A fact is kept only if it points to a document that was actually fetched; anything else is dropped.
- Source references in the report are rebuilt from `sources.json`, never written by the model, so no URL can be invented.
- Fetched pages are treated as data. The prompts tell the model to ignore any instruction they contain.
- Claims from a party to a conflict count as *weak* at best unless independently confirmed. Opinions and forecasts count as *noise*.
- `publish.py` refuses to publish a report that breaks the schema or the coherence rules (8 domains, lo ≤ v ≤ hi, cited sources exist).

### Requirements
- A machine that can run a local LLM server with an **OpenAI-compatible API** and **JSON Schema structured output** (`response_format`), e.g. llama.cpp server, Ollama or vLLM.
- Python 3.9+ (standard library only; `jsonschema` recommended for validation).
- Git, with write access to this repository (a deploy key limited to it is recommended).
- A GitHub Pages site for the PWA.

### Setup
1. **Publish the PWA.** Settings → Pages → branch `main`, folder `/ (root)`.
   Open `https://<account>.github.io/canar-ai-n-the-mine/` on your phone and install it: on Android/Chrome, ⋮ → *Install app*; on iPhone/Safari, Share → *Add to Home Screen*.
2. **On the AI server**, clone the repo, then create an env file **outside** the repo:
   ```bash
   export JANUS_ENDPOINT=http://127.0.0.1:8080/v1   # your local LLM server
   export JANUS_MODEL=<model-name>
   export ZONE="World, focus Canada / Québec"
   export SITUATION="urban, house, family"
   export FREQ="daily"
   export KEEP_DAYS=30          # local retention of snapshots and intermediate files
   export JANUS_CTX_CHARS=60000 # source text per extraction call (fits a 32K context)
   ```
3. **Run once by hand** and note how long it takes.
   ```bash
   source ~/.config/canar/env && cd janus && ./run_canari.sh
   ```
4. **Schedule it every day**, e.g. at 05:40, through `run_canari.sh` (switches the AI server to its "canari" mode, then restores the previous one):
   ```cron
   40 5 * * * . $HOME/.config/canar/env && cd $HOME/canar-ai-n-the-mine && git pull -q && cd janus && ./run_canari.sh >> run.log 2>&1
   ```
If an AI agent operates your server, it works from two files: `AGENTS.md` (its permanent rules) and `janus/TASKS.md` (the ordered task list, each with a status). A session then needs a single instruction: *pull the repo, read AGENTS.md and janus/TASKS.md, do the next task marked "ready"*. Only you mark a task `ready`.

### Daily rhythm
- Each report is compared with the **previous day's** report. On most days little changes, and the PWA shows mostly « = IDEM »: that is the expected result, not a bug.
- The prompts tell the model to keep only facts from the period, not to repeat facts already counted, and not to nudge probabilities without a new fact. This avoids daily noise.
- Running the chain twice on the same day replaces that day's report and still compares it with the day before.
- On the phone, the PWA keeps the last 180 reports (about 6 months) and downloads only the new ones. The full history stays in `data/`.
- On the server, snapshots and intermediate files older than `KEEP_DAYS` are deleted by `run.sh`. Published reports are never deleted.

### Doomsday Clock (yearly reference)
The top banner shows, next to your alert level, the Doomsday Clock of the Bulletin of the Atomic Scientists: a global, yearly reference, not part of the daily report.
It comes from `data/doomsday.json`, which you update **by hand once a year** (late January, when the Bulletin announces the new time): `seconds`, `previous`, `previous_year`, `date`. Delete the file to hide the card.

### Sources
`janus/sources.json` is the heart of the report: **the model only knows what these sources say.**
The provided list (about 40 entries) is tuned for a world view with a Canada / Québec focus. It favours institutions that publish dated, measurable facts: central bank, statistics agency, energy agencies, cyber centres, public health, civil protection, the UN, the FAO and the WHO. A few media and state-affiliated outlets are included for the Middle East, flagged so the model weighs them accordingly.

Each entry has these fields:
```json
{ "id": "boc-press",
  "title": "Press releases",
  "publisher": "Bank of Canada",
  "url": "https://www.bankofcanada.ca/press/press-releases/",
  "domains": ["social", "energie"],
  "verifie": true }
```
- `domains` decides which extraction pass reads the source. The ids are `geo`, `energie`, `supply`, `cyber`, `climat`, `sante`, `social` and `prep`.
- `publisher` is shown to the model with every document. Use it to state reliability, e.g. *"state-affiliated agency: weak signal, cross-check"*.
- `verifie` records whether the URL was tested without JavaScript. Set it to `false` for anything new.
- `_non_retenues` lists sources that were considered and rejected, with the reason. Check it before adding something back.

**Adapting the list to your needs:**
- **Change the zone.** Swap the regional institutions for your own: national statistics office, central bank, civil protection agency, public health institute, grid operator.
- **Change the focus.** If a domain matters more to you, such as health or cyber, give it 4 to 6 solid sources. A domain with 0 to 2 sources will produce thin or empty analysis.
- **Prefer** RSS/Atom feeds or static news pages from primary institutions. **Avoid** paywalled media, JavaScript-only apps, PDFs, annual reports, and opinion pieces, which are noise for a daily fact-based report.
- **Always append** new sources at the end of the list and never reorder it: the order defines the source numbers [n] used in past reports.
- **Test** after any change with `python3 fetch_sources.py`. It prints, for each source, whether text was retrieved.

### Repository layout
```
index.html · style.css · app.js · manifest.webmanifest · sw.js · icons/   PWA
schema.json                     report format (generation, validation, PWA)
data/index.json, data/*.json    published reports (read by the PWA)
data/doomsday.json              yearly Doomsday Clock reference (edited by hand)
janus/sources.json              your validated sources
janus/fetch_sources.py          step 0: dated snapshot
janus/prompts/extract.txt       step 1 prompt: fact extraction
janus/prompts/synthesize.txt    step 2 prompt: report writing
janus/generate.py               steps 1–2 against the local LLM
janus/publish.py                step 3: validation, data/, git push
janus/run.sh                    full chain (expects the LLM server to be up)
janus/run_canari.sh             daily entry point: switch to "canari" mode, run, restore previous mode
AGENTS.md                       rules for the AI agent that operates the server
janus/TASKS.md                  ordered tasks for that agent, with status
```
After changing any PWA file, bump `VERSION` in `sw.js` so phones refresh their cache.

### Privacy
- Reports contain your zone and household situation. **Prefer a private repository**, or keep the configuration generic if it is public.
- Never commit keys, tokens or the env file. `janus/snapshots/` and `janus/out/` are git-ignored.

---

## Français

### De quoi s'agit-il
Un rapport **quotidien** de veille des risques, généré **entièrement sur ton propre matériel** par un modèle de langue local, et lu sur ton téléphone dans une petite PWA hors ligne.
La PWA calcule seule ce qui a bougé depuis le rapport précédent (▲ ▼ ► 🆕) et replie ce qui n'a pas changé (« = IDEM »). Tu ne lis donc que les changements.
Le projet n'utilise ni IA dans le cloud ni clé API, et tes données restent chez toi.

### Fonctionnement
```
sources.json ──► fetch_sources.py ──► generate.py (IA locale) ──► publish.py ──► data/ ──► PWA
  ta liste         instantané daté     1. extraire les faits        validation      GitHub    téléphone
                   (texte brut)        2. rédiger le rapport        + git push      Pages
```
1. **Instantané** : chaque source est téléchargée une fois et figée en texte brut dans un dossier daté.
2. **Extraction** (`prompts/extract.txt`) : domaine par domaine, le modèle liste les faits présents dans les documents. Chaque fait est rattaché au numéro de sa source et classé *fort*, *faible* ou *bruit*.
3. **Synthèse** (`prompts/synthesize.txt`) : le modèle compare ces faits au rapport précédent et rédige le nouveau. Sa sortie doit obligatoirement respecter `schema.json`.
4. **Publication** : le rapport est validé (schéma et contrôles de cohérence), puis commité dans `data/`. La PWA le récupère au lancement.

Le rapport couvre 8 domaines : géopolitique, énergie, chaînes d'approvisionnement, cyber, climat, santé, social et signaux de préparation officielle.
Il utilise une échelle d'alerte à 5 niveaux, de N0 vert à N4 noir.

### Garde-fous intégrés
- Un fait n'est retenu que s'il renvoie à un document réellement téléchargé ; les autres sont écartés.
- Les sources citées dans le rapport sont reconstruites depuis `sources.json`, jamais écrites par le modèle : aucune URL ne peut être inventée.
- Les pages téléchargées sont traitées comme des données. Les prompts demandent au modèle d'ignorer toute instruction qu'elles contiendraient.
- L'affirmation d'une partie au conflit vaut au mieux *faible* si rien d'indépendant ne la confirme. Une opinion ou une prévision compte comme du *bruit*.
- `publish.py` refuse de publier un rapport qui enfreint le schéma ou les règles de cohérence (8 domaines, lo ≤ v ≤ hi, sources citées existantes).

### Prérequis
- Une machine capable de faire tourner un serveur LLM local avec une **API compatible OpenAI** et la **sortie structurée par JSON Schema** (`response_format`), par exemple llama.cpp server, Ollama ou vLLM.
- Python 3.9 ou plus (bibliothèque standard ; `jsonschema` recommandé pour la validation).
- Git, avec un accès en écriture à ce dépôt (de préférence une clé de déploiement limitée au dépôt).
- Un site GitHub Pages pour la PWA.

### Mise en place
1. **Publier la PWA.** Settings → Pages → branche `main`, dossier `/ (root)`.
   Ouvre `https://<compte>.github.io/canar-ai-n-the-mine/` sur ton téléphone et installe-la : sur Android/Chrome, ⋮ → *Installer l'application* ; sur iPhone/Safari, Partager → *Sur l'écran d'accueil*.
2. **Sur le serveur IA**, clone le dépôt, puis crée un fichier d'environnement **hors** du dépôt :
   ```bash
   export JANUS_ENDPOINT=http://127.0.0.1:8080/v1   # ton serveur LLM local
   export JANUS_MODEL=<nom-du-modèle>
   export ZONE="Monde, focus Canada / Québec"
   export SITUATION="urbain, maison, famille"
   export FREQ="quotidien"
   export KEEP_DAYS=30          # conservation locale des instantanés et fichiers intermédiaires
   export JANUS_CTX_CHARS=60000 # texte des sources par appel d'extraction (tient dans 32K)
   ```
3. **Lancer une première fois à la main** et noter la durée.
   ```bash
   source ~/.config/canar/env && cd janus && ./run_canari.sh
   ```
4. **Planifier tous les jours**, par exemple à 5h40, via `run_canari.sh` (passe le serveur IA en mode « canari », puis restaure le mode précédent) :
   ```cron
   40 5 * * * . $HOME/.config/canar/env && cd $HOME/canar-ai-n-the-mine && git pull -q && cd janus && ./run_canari.sh >> run.log 2>&1
   ```
Si un agent IA administre ton serveur, il travaille à partir de deux fichiers : `AGENTS.md` (ses règles permanentes) et `janus/TASKS.md` (la liste ordonnée des tâches, chacune avec un statut). Une séance tient alors en une instruction : *récupère le dépôt, lis AGENTS.md et janus/TASKS.md, fais la prochaine tâche marquée « ready »*. Toi seul passes une tâche en `ready`.

### Rythme quotidien
- Chaque rapport est comparé à celui de **la veille**. La plupart des jours, peu de choses changent et la PWA affiche surtout « = IDEM » : c'est le résultat attendu, pas une panne.
- Les prompts demandent au modèle de ne retenir que les faits de la période, de ne pas répéter un fait déjà pris en compte et de ne pas retoucher une probabilité sans fait nouveau. Cela évite le bruit d'un jour à l'autre.
- Relancer la chaîne deux fois le même jour remplace le rapport du jour, toujours comparé à celui de la veille.
- Sur le téléphone, la PWA garde les 180 derniers rapports (environ 6 mois) et ne télécharge que les nouveaux. L'historique complet reste dans `data/`.
- Sur le serveur, `run.sh` supprime les instantanés et fichiers intermédiaires plus vieux que `KEEP_DAYS`. Les rapports publiés ne sont jamais supprimés.

### Doomsday Clock (repère annuel)
Le bandeau du haut affiche, à côté de ton niveau d'alerte, la Doomsday Clock du Bulletin of the Atomic Scientists : un repère mondial et annuel, qui ne fait pas partie du rapport quotidien.
Elle vient de `data/doomsday.json`, à mettre à jour **à la main une fois par an** (fin janvier, à l'annonce du Bulletin) : `seconds`, `previous`, `previous_year`, `date`. Supprime le fichier pour masquer la carte.

### Sources
`janus/sources.json` est le cœur du rapport : **le modèle ne sait que ce que disent ces sources.**
La liste fournie (une quarantaine d'entrées) est réglée pour une vue mondiale avec un focus Canada / Québec. Elle privilégie les institutions qui publient des faits datés et mesurables : banque centrale, institut de statistique, agences de l'énergie, centres cyber, santé publique, sécurité civile, ONU, FAO et OMS. Quelques médias et agences affiliées à des États couvrent le Moyen-Orient ; ils sont signalés pour que le modèle en tienne compte.

Chaque entrée contient ces champs :
```json
{ "id": "boc-press",
  "title": "Communiqués de presse",
  "publisher": "Banque du Canada",
  "url": "https://www.bankofcanada.ca/press/press-releases/",
  "domains": ["social", "energie"],
  "verifie": true }
```
- `domains` détermine quelle passe d'extraction lit la source. Les identifiants sont `geo`, `energie`, `supply`, `cyber`, `climat`, `sante`, `social` et `prep`.
- `publisher` est transmis au modèle avec chaque document. Sers-t'en pour indiquer la fiabilité, par exemple *« agence affiliée à un État : signal faible, à recouper »*.
- `verifie` indique si l'URL a été testée sans JavaScript. Mets `false` pour toute nouvelle source.
- `_non_retenues` liste les sources envisagées puis écartées, avec la raison. Consulte-la avant d'en rajouter une.

**Adapter la liste à tes besoins :**
- **Changer de zone.** Remplace les institutions régionales par les tiennes : institut de statistique, banque centrale, sécurité civile, santé publique, gestionnaire du réseau électrique.
- **Changer de priorités.** Si un domaine compte plus pour toi, comme la santé ou le cyber, donne-lui 4 à 6 sources solides. Un domaine qui n'a que 0 à 2 sources donnera une analyse pauvre ou vide.
- **Privilégie** les flux RSS/Atom ou les pages d'actualités statiques des institutions primaires. **Évite** les médias payants, les applications qui exigent JavaScript, les PDF, les rapports annuels et les opinions : dans un rapport quotidien fondé sur les faits, ce n'est que du bruit.
- **Ajoute toujours** les nouvelles sources à la fin de la liste et ne la réordonne jamais : l'ordre fixe les numéros [n] cités dans les anciens rapports.
- **Teste** après chaque modification avec `python3 fetch_sources.py`. Il indique, pour chaque source, si du texte a été récupéré.

### Organisation du dépôt
```
index.html · style.css · app.js · manifest.webmanifest · sw.js · icons/   PWA
schema.json                     format du rapport (génération, validation, PWA)
data/index.json, data/*.json    rapports publiés (lus par la PWA)
data/doomsday.json              repère annuel Doomsday Clock (modifié à la main)
janus/sources.json              tes sources validées
janus/fetch_sources.py          étape 0 : instantané daté
janus/prompts/extract.txt       prompt de l'étape 1 : extraction des faits
janus/prompts/synthesize.txt    prompt de l'étape 2 : rédaction du rapport
janus/generate.py               étapes 1–2 avec le LLM local
janus/publish.py                étape 3 : validation, data/, git push
janus/run.sh                    chaîne complète (suppose le serveur LLM démarré)
janus/run_canari.sh             point d'entrée quotidien : mode « canari », veille, retour au mode précédent
AGENTS.md                       règles de l'agent IA qui administre le serveur
janus/TASKS.md                  tâches ordonnées de cet agent, avec statut
```
Après toute modification d'un fichier de la PWA, incrémente `VERSION` dans `sw.js` pour que les téléphones rafraîchissent leur cache.

### Confidentialité
- Les rapports contiennent ta zone et ta situation familiale. **Préfère un dépôt privé**, ou garde une configuration générique si le dépôt est public.
- Ne commite jamais de clé, de jeton ni le fichier d'environnement. `janus/snapshots/` et `janus/out/` sont exclus par `.gitignore`.
