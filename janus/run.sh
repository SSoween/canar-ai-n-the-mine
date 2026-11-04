#!/usr/bin/env bash
# Chaîne complète : instantané des sources → génération locale → validation → publication.
# Rythme quotidien (crontab -e), ex. tous les jours à 5h40 :
#   40 5 * * * . $HOME/.config/canar/env && cd $HOME/canar-ai-n-the-mine && git pull -q && cd janus && ./run.sh >> run.log 2>&1
set -euo pipefail
cd "$(dirname "$0")"
TODAY=$(date +%F)
KEEP_DAYS="${KEEP_DAYS:-30}"   # durée de conservation des instantanés et fichiers intermédiaires locaux
mkdir -p out snapshots

# Rapport précédent = le plus récent STRICTEMENT antérieur à aujourd'hui (une relance le même jour
# ne doit pas se comparer à elle-même).
PREV=""
for f in $(ls ../data/[0-9]*.json 2>/dev/null | sort); do
  [[ "$(basename "$f" .json)" < "$TODAY" ]] && PREV="$f"
done

python3 fetch_sources.py --sources sources.json --out snapshots --date "$TODAY"
python3 generate.py --snapshot "snapshots/$TODAY" ${PREV:+--prev "$PREV"} \
  --zone "${ZONE:-non précisée}" --situation "${SITUATION:-non précisée}" --frequence "${FREQ:-quotidien}" \
  --date "$TODAY" --out "out/$TODAY.json" --keep-facts "out/$TODAY.facts.json"
if [ "${NO_PUBLISH:-0}" = "1" ]; then
  # Essai à blanc : valide le rapport sans l'écrire dans data/ ni le pousser
  python3 publish.py "out/$TODAY.json" --repo .. --check-only
else
  python3 publish.py "out/$TODAY.json" --repo .. --git
fi

# Rétention locale (fichiers non versionnés uniquement : snapshots/ et out/ sont dans .gitignore)
find snapshots -mindepth 1 -maxdepth 1 -type d -mtime +"$KEEP_DAYS" -exec rm -rf {} + 2>/dev/null || true
find out -maxdepth 1 -type f -mtime +"$KEEP_DAYS" -delete 2>/dev/null || true
