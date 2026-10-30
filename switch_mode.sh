#!/bin/bash
#
# switch_mode.sh — Bascule entre les modes RAG / DEV / MIXED / CANARI
#
# Usage :
#   ./switch_mode.sh rag          → Qwen 16k (GPU 0) + embeddings (GPU 1)
#   ./switch_mode.sh dev-single   → Bonsai 8k (GPU 1)
#   ./switch_mode.sh dev-split    → Bonsai 16k (GPU 0+1)
#   ./switch_mode.sh dev-long     → Bonsai 128k (GPU 0+1)
#   ./switch_mode.sh mixed        → Qwen 4k + Bonsai 4k + embeddings CPU
#   ./switch_mode.sh canari       → Qwen 32k (GPU 0+1), veille quotidienne canar-ai-n-the-mine
#   ./switch_mode.sh status       → État actuel
#   ./switch_mode.sh current      → Nom du dernier mode activé (utilisé par run_canari.sh)
#

set -e

export COMPOSE_IGNORE_ORPHANS=1

COMPOSE_DIR="$HOME/ai-server/compose"
STATE_FILE="$HOME/.ai-mode"          # NOUVEAU : mémorise le mode actif

# Fonctions utilitaires
stop_all() {
    echo "→ Arrêt de tous les conteneurs IA..."
    docker stop llama-server 2>/dev/null || true
    docker rm -f llama-server 2>/dev/null || true
    docker stop embeddings-server 2>/dev/null || true
    docker rm -f embeddings-server 2>/dev/null || true
    docker stop bonsai-server 2>/dev/null || true
    docker rm -f bonsai-server 2>/dev/null || true
    sleep 2
}

# MODIFIÉ : 3e paramètre optionnel = délai max en secondes (défaut 90 s, comme avant).
# Avant, le "9000" passé par dev-long était ignoré.
wait_ready() {
    local port=$1
    local name=$2
    local timeout=${3:-90}
    local max_tries=$(( timeout / 3 ))
    local tries=0
    echo -n "→ Attente de $name (port $port)"
    until curl -s "http://127.0.0.1:$port/health" >/dev/null 2>&1 || \
          curl -s "http://127.0.0.1:$port/v1/models" >/dev/null 2>&1; do
        sleep 3
        tries=$((tries + 1))
        if [ $tries -gt $max_tries ]; then
            echo " ⚠️  timeout (vérifier logs)"
            return 1
        fi
        echo -n "."
    done
    echo " ✔"
}

show_vram() {
    echo ""
    echo "=== VRAM actuelle ==="
    nvidia-smi --query-gpu=index,name,memory.used,memory.total --format=csv,noheader
}

set_state() {
    echo "$1" > "$STATE_FILE"
}

case "$1" in
    rag)
        echo "=== Mode RAG ==="
        stop_all
        docker compose -f "$COMPOSE_DIR/llama-server.yml" up -d
        docker compose -f "$COMPOSE_DIR/embeddings.yml" up -d
        wait_ready 8080 "Qwen"
        wait_ready 8081 "embeddings"
        show_vram
        set_state rag
        echo ""
        echo "✔ Mode RAG actif. Qwen + embeddings disponibles."
        ;;

    dev-single)
        echo "=== Mode DEV-single ==="
        stop_all
        docker compose -f "$COMPOSE_DIR/bonsai-single.yml" up -d
        wait_ready 8083 "Bonsai"
        show_vram
        set_state dev-single
        echo ""
        echo "✔ Mode DEV-single actif. Bonsai disponible sur GPU 1."
        ;;

    dev-split)
        echo "=== Mode DEV-split ==="
        stop_all
        docker compose -f "$COMPOSE_DIR/bonsai-split.yml" up -d
        wait_ready 8083 "Bonsai split"
        show_vram
        set_state dev-split
        echo ""
        echo "✔ Mode DEV-split actif. Bonsai disponible sur GPU 0+1."
        ;;

    mixed)
        echo "=== Mode MIXED ==="
        stop_all
        docker compose -f "$COMPOSE_DIR/mixed.yml" up -d
        wait_ready 8080 "Qwen"
        wait_ready 8081 "embeddings"
        wait_ready 8083 "Bonsai"
        show_vram
        set_state mixed
        echo ""
        echo "✔ Mode MIXED actif. Qwen + Bonsai + embeddings (CPU) disponibles."
        ;;

    dev-long)
        echo "=== Mode DEV-LONG (Bonsai split, ctx 128K) ==="
        stop_all
        sleep 5
        # ⚠️ À VÉRIFIER : même fichier que dev-split. Si le 128K n'est pas réglé ailleurs,
        #    dev-long et dev-split lancent exactement la même chose.
        docker compose -f "$COMPOSE_DIR/bonsai-split.yml" up -d
        wait_ready 8083 "Bonsai 128K" 300
        show_vram
        set_state dev-long
        echo ""
        echo "✔ Mode DEV-LONG actif. Bonsai sur GPU 0+1, contexte 128K."
        ;;

    canari)
        echo "=== Mode CANARI (Qwen, GPU 0+1, ctx 32K) ==="
        stop_all
        docker compose -f "$COMPOSE_DIR/canari.yml" up -d
        wait_ready 8080 "Qwen canari" 600
        show_vram
        set_state canari
        echo ""
        echo "✔ Mode CANARI actif. Qwen 32K sur GPU 0+1 (port 8080)."
        ;;

    status)
        echo "=== État actuel ==="
        echo "Dernier mode activé : $(cat "$STATE_FILE" 2>/dev/null || echo inconnu)"
        docker ps --filter "name=llama-server" --filter "name=embeddings-server" --filter "name=bonsai-server" \
            --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
        show_vram
        ;;

    current)
        cat "$STATE_FILE" 2>/dev/null || true
        ;;

    *)
        echo "Usage : $0 {rag|dev-single|dev-split|dev-long|mixed|canari|status|current}"
        exit 1
        ;;
esac
