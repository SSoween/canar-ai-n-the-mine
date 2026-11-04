#!/usr/bin/env bash
# setup_host.sh — installation de canar-ai-n-the-mine sur l'HÔTE qui fait tourner les serveurs LLM.
# À lancer par le propriétaire, dans un terminal sur le serveur (pas dans le conteneur de l'agent).
# Idempotent : on peut le relancer sans risque. Demande confirmation avant chaque modification. Jamais de sudo.
#
# Usage (sur l'hôte) :
#   curl -fsSLO https://raw.githubusercontent.com/SSoween/canar-ai-n-the-mine/main/janus/setup_host.sh
#   bash setup_host.sh
set -uo pipefail

REPO_SSH_ALIAS="github-canar-host"
REPO_PATH="SSoween/canar-ai-n-the-mine"
REPO_DIR="$HOME/canar-ai-n-the-mine"
KEY="$HOME/.ssh/canar_deploy_host"
ENV_FILE="$HOME/.config/canar/env"
AI_DIR="$HOME/ai-server"
COMPOSE_DIR="$AI_DIR/compose"

ok()   { printf '  \033[32m✔\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
fail() { printf '  \033[31m✖\033[0m %s\n' "$*"; }
step() { printf '\n\033[1m== %s ==\033[0m\n' "$*"; }
ask()  { local a; read -r -p "  → $1 [o/N] " a; [[ "$a" =~ ^[oOyY]$ ]]; }

# ---------------------------------------------------------------------------
step "1/7 Prérequis"
missing=0
for c in git python3 docker ssh ssh-keygen crontab; do
  if command -v "$c" >/dev/null 2>&1; then ok "$c"; else fail "$c introuvable"; missing=1; fi
done
if python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3,9) else 1)'; then ok "Python $(python3 -V | cut -d' ' -f2)"; else fail "Python >= 3.9 requis"; missing=1; fi
[ -x "$AI_DIR/switch_mode.sh" ] || [ -f "$AI_DIR/switch_mode.sh" ] && ok "$AI_DIR/switch_mode.sh" || { fail "$AI_DIR/switch_mode.sh introuvable"; missing=1; }
[ -f "$COMPOSE_DIR/llama-server.yml" ] && ok "$COMPOSE_DIR/llama-server.yml" || { fail "$COMPOSE_DIR/llama-server.yml introuvable (modèle pour canari.yml)"; missing=1; }
command -v nvidia-smi >/dev/null 2>&1 && ok "GPU : $(nvidia-smi --query-gpu=name --format=csv,noheader | paste -sd ', ')" || warn "nvidia-smi introuvable"
if [ "$missing" = 1 ]; then fail "Prérequis manquants : corrige-les puis relance le script."; exit 1; fi

# ---------------------------------------------------------------------------
step "2/7 Clé de déploiement de l'hôte (écriture sur ce seul dépôt)"
mkdir -p "$HOME/.ssh" && chmod 700 "$HOME/.ssh"
if [ -f "$KEY" ]; then ok "Clé déjà présente : $KEY"
elif ask "Créer la clé $KEY (sans phrase de passe, pour la tâche de nuit) ?"; then
  ssh-keygen -t ed25519 -N "" -C "canar-ai host deploy key" -f "$KEY" >/dev/null && ok "Clé créée"
else fail "Clé nécessaire pour publier. Arrêt."; exit 1; fi
if ! grep -q "Host $REPO_SSH_ALIAS" "$HOME/.ssh/config" 2>/dev/null; then
  printf '\nHost %s\n  HostName github.com\n  User git\n  IdentityFile %s\n  IdentitiesOnly yes\n' "$REPO_SSH_ALIAS" "$KEY" >> "$HOME/.ssh/config"
  chmod 600 "$HOME/.ssh/config"; ok "Alias SSH $REPO_SSH_ALIAS ajouté à ~/.ssh/config"
else ok "Alias SSH $REPO_SSH_ALIAS déjà configuré"; fi
# Empreinte officielle de GitHub (ed25519), vérifiée avant d'accepter l'hôte
GH_FP="SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU"
if ! ssh-keygen -F github.com >/dev/null 2>&1; then
  tmp=$(mktemp); ssh-keyscan -t ed25519 github.com 2>/dev/null > "$tmp"
  if ssh-keygen -lf "$tmp" | grep -q "$GH_FP"; then cat "$tmp" >> "$HOME/.ssh/known_hosts"; ok "Clé d'hôte GitHub vérifiée et ajoutée"
  else fail "Empreinte GitHub inattendue : arrêt par sécurité."; rm -f "$tmp"; exit 1; fi
  rm -f "$tmp"
else ok "github.com déjà dans known_hosts"; fi
if ssh -o BatchMode=yes -T "git@$REPO_SSH_ALIAS" 2>&1 | grep -q "successfully authenticated"; then
  ok "Authentification GitHub OK"
else
  warn "Ajoute cette clé PUBLIQUE dans GitHub : dépôt → Settings → Deploy keys → Add deploy key"
  warn "Titre « Janus host », cocher « Allow write access »."
  echo; cat "$KEY.pub"; echo
  read -r -p "  → Appuie sur Entrée une fois la clé ajoutée… " _
  ssh -o BatchMode=yes -T "git@$REPO_SSH_ALIAS" 2>&1 | grep -q "successfully authenticated" \
    && ok "Authentification GitHub OK" || { fail "Authentification refusée. Vérifie la clé et relance."; exit 1; }
fi

# ---------------------------------------------------------------------------
step "3/7 Dépôt"
if [ -d "$REPO_DIR/.git" ]; then
  git -C "$REPO_DIR" remote set-url origin "git@$REPO_SSH_ALIAS:$REPO_PATH.git"
  git -C "$REPO_DIR" pull -q --rebase && ok "Dépôt à jour : $(git -C "$REPO_DIR" log --oneline -1)"
elif ask "Cloner le dépôt dans $REPO_DIR ?"; then
  git clone -q "git@$REPO_SSH_ALIAS:$REPO_PATH.git" "$REPO_DIR" && ok "Dépôt cloné"
else fail "Dépôt nécessaire. Arrêt."; exit 1; fi
git -C "$REPO_DIR" config user.name  >/dev/null || git -C "$REPO_DIR" config user.name "Janus host"
git -C "$REPO_DIR" config user.email >/dev/null || git -C "$REPO_DIR" config user.email "janus-host@canar-ai.local"
chmod +x "$REPO_DIR"/janus/*.sh "$REPO_DIR"/janus/*.py 2>/dev/null || true

# ---------------------------------------------------------------------------
step "4/7 Environnement Python"
if [ -x "$REPO_DIR/.venv/bin/python" ] && "$REPO_DIR/.venv/bin/python" -c 'import jsonschema' 2>/dev/null; then
  ok ".venv avec jsonschema déjà prêt"
elif ask "Créer $REPO_DIR/.venv et y installer jsonschema ?"; then
  python3 -m venv "$REPO_DIR/.venv" && "$REPO_DIR/.venv/bin/pip" install -q --upgrade pip jsonschema \
    && ok ".venv prêt" || { fail "Échec de création du .venv (paquet python3-venv manquant ?)"; exit 1; }
else warn "Sans jsonschema, la validation sera réduite."; fi

# ---------------------------------------------------------------------------
step "5/7 Fichier de réglages $ENV_FILE"
if [ -f "$ENV_FILE" ]; then ok "Déjà présent (non modifié)"
elif ask "Créer $ENV_FILE ?"; then
  mkdir -p "$(dirname "$ENV_FILE")"
  cat > "$ENV_FILE" <<'EOF'
export JANUS_ENDPOINT=http://127.0.0.1:8080/v1
export JANUS_MODEL=local            # remplacé à l'étape 7 par l'identifiant lu dans /v1/models
export JANUS_CTX_CHARS=60000
export ZONE="Monde, focus Canada / Québec"
export SITUATION="urbain, maison, famille"
export FREQ="quotidien"
export KEEP_DAYS=30
EOF
  chmod 600 "$ENV_FILE"; ok "Créé (chmod 600)"
fi

# ---------------------------------------------------------------------------
step "6/7 Mode « canari » du serveur IA"
if grep -q "canari)" "$AI_DIR/switch_mode.sh"; then ok "switch_mode.sh connaît déjà le mode canari"
elif ask "Remplacer $AI_DIR/switch_mode.sh par la version du dépôt (sauvegarde .bak) ?"; then
  cp "$AI_DIR/switch_mode.sh" "$AI_DIR/switch_mode.sh.bak.$(date +%F)"
  diff -u "$AI_DIR/switch_mode.sh" "$REPO_DIR/serveur/switch_mode.sh" | head -60 || true
  cp "$REPO_DIR/serveur/switch_mode.sh" "$AI_DIR/switch_mode.sh" && chmod +x "$AI_DIR/switch_mode.sh" && ok "switch_mode.sh mis à jour"
fi
if [ -f "$COMPOSE_DIR/canari.yml" ]; then ok "canari.yml présent"
elif ask "Créer $COMPOSE_DIR/canari.yml à partir de llama-server.yml (à ajuster ensuite) ?"; then
  cp "$COMPOSE_DIR/llama-server.yml" "$COMPOSE_DIR/canari.yml"
  warn "canari.yml = copie de llama-server.yml. Modifie-le maintenant (voir serveur/canari.yml du dépôt) :"
  warn "  1) les deux GPU (device_ids \"0\",\"1\")   2) -c 32768   3) -np 1   4) --tensor-split 1,1"
  warn "  et garde container_name: llama-server, port 8080."
  read -r -p "  → Appuie sur Entrée une fois canari.yml modifié… " _
fi

# ---------------------------------------------------------------------------
step "7/7 Test du mode canari (le serveur IA change de mode, puis revient)"
if ask "Tester maintenant ? (environ 1 à 10 min ; le mode actuel sera restauré)"; then
  prev=$("$AI_DIR/switch_mode.sh" current 2>/dev/null); prev=${prev:-dev-long}
  [ "$prev" = canari ] && prev=dev-long
  echo "  Mode actuel : $prev"
  if "$AI_DIR/switch_mode.sh" canari; then
    model=$(curl -s http://127.0.0.1:8080/v1/models | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d["data"][0]["id"])' 2>/dev/null)
    [ -n "$model" ] && ok "Modèle exposé : $model" || warn "Identifiant du modèle illisible"
    resp=$(curl -s http://127.0.0.1:8080/v1/chat/completions -H 'Content-Type: application/json' -d '{
      "model":"'"${model:-local}"'","temperature":0,
      "messages":[{"role":"user","content":"Return ok=true"}],
      "response_format":{"type":"json_schema","json_schema":{"name":"t","strict":true,
        "schema":{"type":"object","properties":{"ok":{"type":"boolean"}},"required":["ok"],"additionalProperties":false}}}}')
    if echo "$resp" | python3 -c 'import sys,json; c=json.load(sys.stdin)["choices"][0]["message"]["content"]; assert json.loads(c)["ok"] is True' 2>/dev/null; then
      ok "Sortie JSON structurée : OK"
    else fail "Sortie JSON structurée : échec. Réponse brute :"; echo "$resp" | head -c 600; echo; fi
    if [ -n "$model" ] && grep -q '^export JANUS_MODEL=local' "$ENV_FILE" 2>/dev/null; then
      sed -i "s|^export JANUS_MODEL=local.*|export JANUS_MODEL=$model|" "$ENV_FILE" && ok "JANUS_MODEL=$model enregistré"
    fi
  else fail "Le mode canari ne démarre pas : vérifie canari.yml (docker logs llama-server)."; fi
  echo "  Retour au mode $prev…"; "$AI_DIR/switch_mode.sh" "$prev" >/dev/null 2>&1 && ok "Mode $prev restauré" || fail "Restauration échouée : lance $AI_DIR/switch_mode.sh $prev"
fi

step "Terminé"
echo "  Premier passage complet, sans publication automatique :"
echo "    source $ENV_FILE && cd $REPO_DIR/janus && PATH=$REPO_DIR/.venv/bin:\$PATH ./run_canari.sh"
echo "  (run_canari.sh publie à la fin : pour un essai sans publication, voir janus/TASKS.md, tâche H2)"
echo "  Tâche quotidienne à ajouter ensuite avec crontab -e (voir H3) :"
echo "    40 5 * * * . \$HOME/.config/canar/env && cd \$HOME/canar-ai-n-the-mine && git pull -q && cd janus && PATH=\$HOME/canar-ai-n-the-mine/.venv/bin:\$PATH ./run_canari.sh >> run.log 2>&1"
