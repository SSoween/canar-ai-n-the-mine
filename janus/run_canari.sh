#!/usr/bin/env bash
# run_canari.sh — Bascule le serveur IA en mode "canari", lance la veille, puis RESTAURE le mode précédent.
#
# Planification quotidienne (crontab -e), ex. tous les jours à 5h40 :
#   40 5 * * * . $HOME/.config/canar/env && cd $HOME/canar-ai-n-the-mine && git pull -q && cd janus && ./run_canari.sh >> run.log 2>&1
#
# Mettre la veille en pause (ex. session de code de nuit) :  touch ~/.canari-pause
# Reprendre :                                                rm ~/.canari-pause
set -uo pipefail
cd "$(dirname "$0")"

SWITCH="${SWITCH_MODE_SCRIPT:-$HOME/ai-server/switch_mode.sh}"
PAUSE_FILE="${CANARI_PAUSE_FILE:-$HOME/.canari-pause}"
DEFAULT_RESTORE="${CANARI_RESTORE_DEFAULT:-dev-long}"   # si le mode précédent est inconnu
LOCK="${CANARI_LOCK:-/tmp/canar.lock}"

log() { echo "[$(date '+%F %T')] $*"; }

# 1. Une seule exécution à la fois
exec 9>"$LOCK"
if ! flock -n 9; then log "Une exécution est déjà en cours : abandon."; exit 0; fi

# 2. Pause manuelle : on ne touche pas au serveur
if [ -f "$PAUSE_FILE" ]; then log "Pause active ($PAUSE_FILE) : veille sautée, serveur inchangé."; exit 0; fi

# 3. Mémoriser le mode actuel pour le restaurer
PREV_MODE="$("$SWITCH" current 2>/dev/null || true)"
if [ -z "$PREV_MODE" ] || [ "$PREV_MODE" = "canari" ]; then PREV_MODE="$DEFAULT_RESTORE"; fi

restore() {
  log "Retour au mode $PREV_MODE"
  "$SWITCH" "$PREV_MODE" >/dev/null 2>&1 \
    && log "Mode $PREV_MODE restauré." \
    || log "⚠️ Restauration échouée : lancer '$SWITCH $PREV_MODE' à la main."
}
trap restore EXIT
trap 'exit 130' INT TERM          # pour que la restauration ait lieu même en cas d'interruption

# 4. Bascule, veille, mesure de durée
log "Mode actuel : $PREV_MODE → bascule en canari"
if ! "$SWITCH" canari >/dev/null 2>&1; then log "Échec du passage en mode canari (voir docker logs llama-server)."; exit 1; fi

START=$(date +%s)
./run.sh
RC=$?
log "Veille terminée (code $RC) en $(( ($(date +%s) - START) / 60 )) min."
exit $RC
