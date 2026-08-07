#!/usr/bin/env bash
#
# Sauvegarde du volume `gdv-data` et du `.env` qui va avec.
#
# Les deux vont ensemble et c'est le point à ne pas rater : le volume contient
# le refresh token Google **chiffré**, que seul `TOKEN_KEY` déchiffre. Une
# archive sans son `.env` impose de refaire le consentement Google.
#
#   ./deploy/backup.sh            archive locale, puis envoi par rclone
#   ./deploy/backup.sh --local    archive locale seulement (ce qu'appelle deploy.sh)
#
# Le remote rclone se configure hors du dépôt (`rclone config`), et se nomme par
# GDV_BACKUP_REMOTE. Aucun secret ne vit ici.

set -euo pipefail

cd "$(dirname "$0")/.."

DESTINATION=${GDV_BACKUP_DIR:-$PWD/sauvegardes}
# N'importe quel remote rclone convient — S3 et compatibles, Backblaze B2, un
# disque distant en SFTP. `rclone config` le nomme, GDV_BACKUP_REMOTE le
# désigne ; le dépôt n'en privilégie aucun et n'en connaît aucun secret.
REMOTE=${GDV_BACKUP_REMOTE:-sauvegardes:gdv}
RETENTION=7

local_seulement=false
case "${1:-}" in
'') ;;
--local) local_seulement=true ;;
*)
  echo "usage: $0 [--local]" >&2
  exit 2
  ;;
esac

if [[ ! -f .env ]]; then
  echo "Pas de .env ici : lance ce script depuis le dépôt de l'instance." >&2
  exit 1
fi

# Le volume n'existe qu'une fois l'instance démarrée une première fois. Sur une
# installation neuve il n'y a rien à sauvegarder, et ce n'est pas une erreur —
# c'est en revanche à distinguer du volume présent mais vide, plus bas.
if ! docker volume inspect gdv-data >/dev/null 2>&1; then
  echo "Pas de volume gdv-data : instance jamais démarrée, rien à sauvegarder."
  exit 0
fi

mkdir -p "$DESTINATION"
# Absolu obligatoire : docker prend un `-v chemin/relatif:/…` pour un **volume
# nommé**, et monterait donc un répertoire vide sans se plaindre.
DESTINATION=$(cd "$DESTINATION" && pwd)
horodatage=$(date +%F-%H%M%S)
archive="$DESTINATION/gdv-$horodatage.tar.gz"
secrets="$DESTINATION/gdv-$horodatage.env"
# `.tgz` et non `.tar.gz`, et ce n'est pas une coquetterie : l'élagage distingue
# les archives par motif, et `gdv-*.tar.gz` engloberait celle-ci. La rétention
# tomberait à trois sauvegardes réelles au lieu de sept, sans un message.
configuration="$DESTINATION/gdv-$horodatage.config.tgz"

# L'arrêt dure quelques secondes, et c'est le prix d'un SQLite au repos : pas de
# WAL en vol au moment du `tar`. Le compromis est assumé face à un `db.backup()`
# à chaud, plus fragile à déclencher depuis l'extérieur du conteneur.
echo "→ arrêt de l'application"
docker compose stop app
# `start` même en cas d'échec : une sauvegarde ratée ne doit pas laisser
# l'instance éteinte.
trap 'docker compose start app >/dev/null' EXIT

echo "→ archive de gdv-data"
# Le conteneur écrit en root ; l'archive appartient donc à root, en 0644. Elle
# reste lisible par rclone et supprimable par l'élagage, qui n'a besoin que du
# droit d'écriture sur le répertoire.
docker run --rm \
  -v gdv-data:/data:ro \
  -v "$DESTINATION:/sortie" \
  alpine tar czf "/sortie/$(basename "$archive")" -C /data .

# Le défaut de compose préfixait les volumes du nom du répertoire de travail :
# `-v gdv-data:…` montait alors un volume neuf et vide, et produisait une
# archive vide sans un mot d'erreur (D53). Le `name:` explicite du
# docker-compose.yml a réglé la cause ; ce contrôle vérifie l'effet, parce que
# c'est précisément le genre de panne qu'on ne découvre qu'à la restauration.
# Le contenu passe par une variable, sans pipe : `grep -q` sort dès la première
# correspondance, `tar` prendrait un SIGPIPE, et `pipefail` ferait échouer le
# test sur une archive pourtant valide.
contenu=$(tar tzf "$archive")
if ! grep -q 'gdv\.db' <<<"$contenu"; then
  echo "Archive sans gdv.db — le volume monté n'est pas le bon. Rien de sauvegardé." >&2
  rm -f "$archive"
  exit 1
fi

cp .env "$secrets"
chmod 600 "$secrets"

# `config/` est monté depuis l'hôte : ni le tar du volume ni le `.env` ne
# l'emportent. Il porte la clé du compte de service, que Google ne délivre
# **qu'une fois** — une restauration sans elle rend la base et les comptes, mais
# aucun accès à Drive, et la panne n'apparaît qu'à la première synchronisation.
# Le répertoire entier plutôt qu'une liste : filtrer supposerait un motif à tenir
# en phase avec `.gitignore`, et l'exemple suivi par git qui voyage avec pèse
# deux kilo-octets.
if [[ -d config ]]; then
  tar czf "$configuration" config
  chmod 600 "$configuration"
fi

docker compose start app >/dev/null
trap - EXIT
echo "→ application redémarrée"

# Élagage. Les noms sont produits ici, sans espace ni retour à la ligne : le
# découpage de `ls` est sûr dans ce cas précis.
elaguer() {
  local motif=$1 vieux
  # Boucle `for` et non `| while` : sous `pipefail`, un `ls` sans correspondance
  # ferait échouer tout le pipeline, donc le script, sur un répertoire vide.
  # shellcheck disable=SC2012,SC2086
  for vieux in $(ls -1t "$DESTINATION"/$motif 2>/dev/null | tail -n "+$((RETENTION + 1))"); do
    echo "  · élagage $(basename "$vieux")"
    rm -f "$vieux"
  done
}
elaguer 'gdv-*.tar.gz'
elaguer 'gdv-*.env'
elaguer 'gdv-*.config.tgz'

echo "✓ $(basename "$archive") ($(du -h "$archive" | cut -f1)), son .env$(
  [[ -f $configuration ]] && echo ' et son config/'
)"

if [[ $local_seulement == true ]]; then
  exit 0
fi

# Une sauvegarde qui vit sur la machine qu'elle protège ne protège de rien.
if ! command -v rclone >/dev/null; then
  echo "rclone absent : archive gardée en local. Installe-le, ou passe --local." >&2
  exit 1
fi

echo "→ envoi vers $REMOTE"
rclone copy "$archive" "$REMOTE"
rclone copy "$secrets" "$REMOTE"
# `if` et non `[[ … ]] &&` : sous `set -e`, un test faux en dernière position du
# script le ferait sortir en erreur alors qu'une absence de `config/` est un cas
# normal — une instance en OAuth n'en a pas.
if [[ -f $configuration ]]; then
  rclone copy "$configuration" "$REMOTE"
fi
echo "✓ envoyé"
