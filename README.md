# canar-ai-n-the-mine

Early-warning watch for systemic risks. Alert level, what changed since last time, no doom. A tiny offline PWA, fed by a local AI.

🇬🇧 [English](#english) · 🇫🇷 [Français](#français)

---

## English

### What it is
A monthly risk report generated **entirely on your own hardware** by a local LLM, and read on your phone through a small offline PWA.
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
   export FREQ="monthly"
   ```
3. **Run once by hand.**
   ```bash
   source ~/.config/canar/env && cd janus && ./run.sh
   ```
4. **Schedule it**, for example on the 1st of each month:
   ```cron
   40 5 1 * * . $HOME/.config/canar/env && cd $HOME/canar-ai-n-the-mine && git pull -q && cd janus && ./run.sh >> run.log 2>&1
   ```
If an AI agent operates your server, `janus/PROMPTS-JANUS.md` contains ready-to-use operator prompts for setup, first run, scheduling, troubleshooting and quarterly maintenance.

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
- **Prefer** RSS/Atom feeds or static news pages from primary institutions. **Avoid** paywalled media, JavaScript-only apps, PDFs, annual reports, and opinion pieces, which are noise for a monthly fact-based report.
- **Always append** new sources at the end of the list and never reorder it: the order defines the source numbers [n] used in past reports.
- **Test** after any change with `python3 fetch_sources.py`. It prints, for each source, whether text was retrieved.

### Repository layout
```
index.html · style.css · app.js · manifest.webmanifest · sw.js · icons/   PWA
schema.json                     report format (generation, validation, PWA)
data/index.json, data/*.json    published reports (read by the PWA)
janus/sources.json              your validated sources
janus/fetch_sources.py          step 0: dated snapshot
janus/prompts/extract.txt       step 1 prompt: fact extraction
janus/prompts/synthesize.txt    step 2 prompt: report writing
janus/generate.py               steps 1–2 against the local LLM
janus/publish.py                step 3: validation, data/, git push
janus/run.sh                    full chain, cron-ready
janus/PROMPTS-JANUS.md          operator prompts for an AI agent on the server
```
After changing any PWA file, bump `VERSION` in `sw.js` so phones refresh their cache.

### Privacy
- Reports contain your zone and household situation. **Prefer a private repository**, or keep the configuration generic if it is public.
- Never commit keys, tokens or the env file. `janus/snapshots/` and `janus/out/` are git-ignored.

---

## Français

### De quoi s'agit-il
Un rapport mensuel de veille des risques, généré **entièrement sur ton propre matériel** par un modèle de langue local, et lu sur ton téléphone dans une petite PWA hors ligne.
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
   export FREQ="mensuel"
   ```
3. **Lancer une première fois à la main.**
   ```bash
   source ~/.config/canar/env && cd janus && ./run.sh
   ```
4. **Planifier**, par exemple le 1er de chaque mois :
   ```cron
   40 5 1 * * . $HOME/.config/canar/env && cd $HOME/canar-ai-n-the-mine && git pull -q && cd janus && ./run.sh >> run.log 2>&1
   ```
Si un agent IA administre ton serveur, `janus/PROMPTS-JANUS.md` contient des prompts prêts à l'emploi pour l'installation, le premier lancement, la planification, le diagnostic et la maintenance trimestrielle.

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
- **Privilégie** les flux RSS/Atom ou les pages d'actualités statiques des institutions primaires. **Évite** les médias payants, les applications qui exigent JavaScript, les PDF, les rapports annuels et les opinions : dans un rapport mensuel fondé sur les faits, ce n'est que du bruit.
- **Ajoute toujours** les nouvelles sources à la fin de la liste et ne la réordonne jamais : l'ordre fixe les numéros [n] cités dans les anciens rapports.
- **Teste** après chaque modification avec `python3 fetch_sources.py`. Il indique, pour chaque source, si du texte a été récupéré.

### Organisation du dépôt
```
index.html · style.css · app.js · manifest.webmanifest · sw.js · icons/   PWA
schema.json                     format du rapport (génération, validation, PWA)
data/index.json, data/*.json    rapports publiés (lus par la PWA)
janus/sources.json              tes sources validées
janus/fetch_sources.py          étape 0 : instantané daté
janus/prompts/extract.txt       prompt de l'étape 1 : extraction des faits
janus/prompts/synthesize.txt    prompt de l'étape 2 : rédaction du rapport
janus/generate.py               étapes 1–2 avec le LLM local
janus/publish.py                étape 3 : validation, data/, git push
janus/run.sh                    chaîne complète, prête pour cron
janus/PROMPTS-JANUS.md          prompts opérateur pour un agent IA sur le serveur
```
Après toute modification d'un fichier de la PWA, incrémente `VERSION` dans `sw.js` pour que les téléphones rafraîchissent leur cache.

### Confidentialité
- Les rapports contiennent ta zone et ta situation familiale. **Préfère un dépôt privé**, ou garde une configuration générique si le dépôt est public.
- Ne commite jamais de clé, de jeton ni le fichier d'environnement. `janus/snapshots/` et `janus/out/` sont exclus par `.gitignore`.
