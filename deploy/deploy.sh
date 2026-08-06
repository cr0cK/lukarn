#!/usr/bin/env bash
#
# Mise à jour d'une instance en service.
#
#   ./deploy/deploy.sh
#
# Sauvegarde, reconstruit, redémarre — et **attend la confirmation** que
# l'application est revenue. Un `docker compose up -d` rend la main dès que le
# conteneur est lancé, pas quand il fonctionne : une migration qui échoue ou un
# `.env` incomplet laisse un conteneur qui redémarre en boucle pendant qu'on
# croit le déploiement terminé.

set -euo pipefail

cd "$(dirname "$0")/.."

# `--ff-only` : sur une instance, un merge automatique n'a rien à faire. Si la
# copie locale a divergé, il faut le savoir avant de reconstruire.
echo "▸ récupération des sources"
git pull --ff-only

# Les migrations sont append-only et jamais retouchées : si l'une se passe mal,
# cette archive est le seul retour en arrière.
echo "▸ sauvegarde"
./deploy/backup.sh --local

echo "▸ construction et redémarrage"
docker compose up -d --build

# `start-period` 20 s, puis un contrôle toutes les 30 s et 3 essais avant
# `unhealthy` : 110 s au pire pour un verdict, arrondi à 150 s de marge.
PLAFOND=150

conteneur=$(docker compose ps -q app)
if [[ -z $conteneur ]]; then
  echo '✗ aucun conteneur app après le up — voir docker compose ps.' >&2
  exit 1
fi

echouer() {
  echo "✗ $1" >&2
  echo >&2
  docker compose logs --tail=50 app >&2
  exit 1
}

echo "▸ attente de la porte de santé (au plus ${PLAFOND}s)"
debut=$SECONDS
while :; do
  etat=$(docker inspect -f '{{.State.Health.Status}}' "$conteneur" 2>/dev/null || echo absente)

  case $etat in
  healthy) break ;;
  unhealthy) echouer "l'application répond, mais /api/health la déclare en panne." ;;
  absente) echouer "conteneur disparu ou sans HEALTHCHECK." ;;
  esac

  if ((SECONDS - debut >= PLAFOND)); then
    echouer "toujours « $etat » après ${PLAFOND}s."
  fi
  sleep 3
done

echo "✓ déployé — application saine après $((SECONDS - debut))s"
