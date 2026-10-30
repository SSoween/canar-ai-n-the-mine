#!/usr/bin/env bash
# Chaîne complète sur Janus : instantané des sources → génération locale → validation → publication.
# Planification mensuelle (crontab -e), ex. le 1er du mois à 6h :
#   0 6 1 * * cd /chemin/vers/canar-ai-n-the-mine/janus && ./run.sh >> run.log 2>&1
set -euo pipefail
cd "$(dirname "$0")"
TODAY=$(date +%F)
mkdir -p out snapshots
PREV=$(ls ../data/[0-9]*.json 2>/dev/null | sort | tail -n 1 || true)

python3 fetch_sources.py --sources sources.json --out snapshots --date "$TODAY"
python3 generate.py --snapshot "snapshots/$TODAY" ${PREV:+--prev "$PREV"} \
  --zone "${ZONE:-France / Europe}" --situation "${SITUATION:-non précisée}" --frequence "${FREQ:-mensuel}" \
  --date "$TODAY" --out "out/$TODAY.json" --keep-facts "out/$TODAY.facts.json"
python3 publish.py "out/$TODAY.json" --repo .. --git
