#!/usr/bin/env bash
#
# Mise à jour d'une instance en service.
#
#   ./deploy/deploy.sh            tire l'image publiée (défaut)
#   ./deploy/deploy.sh --build    construit depuis les sources
#
# Sauvegarde, met à jour, redémarre — et **attend la confirmation** que
# l'application est revenue. Un `docker compose up -d` rend la main dès que le
# conteneur est lancé, pas quand il fonctionne : une migration qui échoue ou un
# `.env` incomplet laisse un conteneur qui redémarre en boucle pendant qu'on
# croit le déploiement terminé.

set -euo pipefail

cd "$(dirname "$0")/.."

construire=false
case "${1:-}" in
'') ;;
--build) construire=true ;;
*)
  echo "usage: $0 [--build]" >&2
  exit 2
  ;;
esac

# `--ff-only` : sur une instance, un merge automatique n'a rien à faire. Si la
# copie locale a divergé, il faut le savoir avant de mettre à jour. Les sources
# servent même quand on ne construit pas : c'est d'elles que viennent le
# `docker-compose.yml`, le `Caddyfile` et les scripts de cette mise à jour.
echo "▸ récupération des sources"
git pull --ff-only

# Les migrations sont append-only et jamais retouchées : si l'une se passe mal,
# cette archive est le seul retour en arrière.
echo "▸ sauvegarde"
./deploy/backup.sh --local

if $construire; then
  echo "▸ construction et redémarrage"
  docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build
else
  # `pull` séparé du `up` pour que l'échec porte son vrai nom : registre
  # injoignable ou version inexistante se distinguent alors d'un conteneur qui
  # démarre mal, et l'instance en service n'est pas arrêtée pour rien.
  echo "▸ récupération de l'image"
  docker compose pull app
  echo "▸ redémarrage"
  docker compose up -d
fi

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
