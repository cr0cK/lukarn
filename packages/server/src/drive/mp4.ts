/**
 * Lecture de l'en-tête d'un conteneur MP4/QuickTime, par fenêtres.
 *
 * Un fichier ISOBMFF est une suite de boîtes préfixées de leur taille. La date
 * d'enregistrement est dans `moov/mvhd`, mais `moov` n'est pas toujours en
 * tête : un enregistrement de téléphone le place souvent après le `mdat`, à
 * quelques dizaines de méga-octets du début. On ne télécharge donc pas le
 * fichier : on suit la chaîne des tailles depuis l'offset 0, ce qui donne les
 * frontières successives, et on rouvre une fenêtre `Range` sur chacune.
 *
 * **Ce parcours est la seule frontière sûre.** Balayer les octets à la
 * recherche de la signature `moov` échoue en pratique : un fichier réenregistré
 * porte un ancien `moov` neutralisé en `free`, qui contient encore un `mvhd`
 * complet — la signature tombe alors sur une date périmée, parfois de plusieurs
 * mois, sans que rien ne le signale.
 *
 * Les deux fonctions sont pures : aucun accès réseau, l'appelant fournit les
 * tampons. C'est ce qui les rend vérifiables sur des cas construits à la main.
 */

/**
 * Écart entre l'époque QuickTime (1er janvier 1904 UTC) et l'époque Unix, en
 * secondes. Les dates de `mvhd` sont comptées depuis la première.
 */
const EPOCH_1904_OFFSET_S = 2_082_844_800;

/**
 * Une date antérieure à celle-ci est tenue pour absente. Des muxeurs écrivent
 * dans ce champ des secondes comptées depuis 1970, ce qui donne une date des
 * années 1950-1980 : plutôt que de dater la vidéo d'un demi-siècle trop tôt,
 * on laisse l'appelant se rabattre sur le nom du fichier.
 */
const MIN_YEAR = 1990;
const MAX_YEAR = 2200;

/** Ce qu'une fenêtre apprend sur l'emplacement du `moov`. */
export interface MoovScan {
  /** Offset absolu de la boîte `moov`, si la fenêtre l'a atteinte. */
  moovOffset: number | null;
  /**
   * Offset absolu de la prochaine frontière de boîte, quand la fenêtre s'arrête
   * avant le `moov` : c'est là qu'il faut rouvrir. `null` quand il n'y a plus
   * rien à lire — fin du fichier atteinte, ou chaîne de boîtes incohérente.
   */
  nextOffset: number | null;
}

type BoxHeader =
  | {
      kind: 'box';
      /** Taille totale, en-tête compris. `0` signifie « jusqu'à la fin ». */
      size: number;
      type: string;
      /** 8 octets, ou 16 quand la taille est écrite sur 64 bits. */
      headerSize: number;
    }
  /** L'en-tête déborde du tampon : il faut une fenêtre qui commence ici. */
  | { kind: 'truncated' }
  /** Ce ne sont pas des boîtes : conteneur exotique, ou octets quelconques. */
  | { kind: 'invalid' };

/** Un type de boîte est fait de quatre caractères ASCII imprimables. */
function isBoxType(type: string): boolean {
  return /^[\x20-\x7e]{4}$/.test(type);
}

function readBoxHeader(buffer: Buffer, offset: number): BoxHeader {
  if (offset < 0 || offset + 8 > buffer.length) return { kind: 'truncated' };

  const short = buffer.readUInt32BE(offset);
  const type = buffer.toString('latin1', offset + 4, offset + 8);
  if (!isBoxType(type)) return { kind: 'invalid' };

  if (short !== 1) {
    // Une boîte plus courte que son en-tête ne mène nulle part : la parcourir
    // ferait boucler sur place.
    if (short !== 0 && short < 8) return { kind: 'invalid' };
    return { kind: 'box', size: short, type, headerSize: 8 };
  }

  if (offset + 16 > buffer.length) return { kind: 'truncated' };
  const wide = buffer.readBigUInt64BE(offset + 8);
  if (wide < 16n || wide > BigInt(Number.MAX_SAFE_INTEGER)) return { kind: 'invalid' };
  return { kind: 'box', size: Number(wide), type, headerSize: 16 };
}

/**
 * Cherche le `moov` dans une fenêtre du fichier, en suivant la chaîne des
 * boîtes de premier niveau.
 *
 * `buffer` commence **exactement** sur une frontière de boîte, à l'offset
 * `windowStart` du fichier — l'offset 0, ou celui rendu par un appel
 * précédent. Fournir un offset quelconque ferait lire des tailles au hasard.
 */
export function findMoovOffset(buffer: Buffer, windowStart: number, fileSize: number): MoovScan {
  let offset = 0;

  for (;;) {
    const header = readBoxHeader(buffer, offset);

    if (header.kind === 'invalid') return { moovOffset: null, nextOffset: null };

    if (header.kind === 'truncated') {
      const next = windowStart + offset;
      return { moovOffset: null, nextOffset: next < fileSize ? next : null };
    }

    if (header.type === 'moov') return { moovOffset: windowStart + offset, nextOffset: null };

    // `size == 0` : la boîte court jusqu'à la fin du fichier — il n'y a plus
    // aucune frontière après elle.
    const size = header.size === 0 ? fileSize - (windowStart + offset) : header.size;
    if (size < header.headerSize) return { moovOffset: null, nextOffset: null };

    const next = windowStart + offset + size;
    // Plus rien après cette boîte : soit elle finit le fichier, soit elle le
    // déborde et la taille lue n'en était pas une. Dans les deux cas il n'y a
    // pas de `moov` à trouver.
    if (next >= fileSize) return { moovOffset: null, nextOffset: null };

    offset += size;
  }
}

/**
 * Date d'enregistrement portée par `moov/mvhd`, en ISO 8601 UTC, ou `null` si
 * le tampon ne va pas jusque-là, si l'horloge n'était pas renseignée, ou si la
 * valeur lue ne peut pas être une date de prise de vue.
 *
 * `moovOffset` est l'index de la boîte **dans le tampon** — pas dans le
 * fichier : `findMoovOffset` rend un offset absolu, à ramener au début de la
 * fenêtre avant d'appeler ici.
 *
 * L'heure lue n'est pas toujours de l'UTC. Un téléphone y écrit selon les cas
 * son heure locale ou l'heure universelle, et le conteneur ne dit pas laquelle :
 * cette fonction rend ce qui est écrit, sans corriger quoi que ce soit.
 */
export function readCreationTime(buffer: Buffer, moovOffset: number): string | null {
  const moov = readBoxHeader(buffer, moovOffset);
  if (moov.kind !== 'box' || moov.type !== 'moov') return null;

  // Le tampon borne la lecture aussi bien que la taille annoncée : une fenêtre
  // peut s'arrêter au milieu du `moov`.
  const declaredEnd = moov.size === 0 ? buffer.length : moovOffset + moov.size;
  const end = Math.min(declaredEnd, buffer.length);

  let offset = moovOffset + moov.headerSize;
  while (offset < end) {
    const child = readBoxHeader(buffer, offset);
    if (child.kind !== 'box') return null;

    if (child.type === 'mvhd') return readMvhd(buffer, offset + child.headerSize, end);

    const size = child.size === 0 ? end - offset : child.size;
    if (size < child.headerSize) return null;
    offset += size;
  }

  return null;
}

/** Corps d'un `mvhd`, versions 0 (dates 32 bits) et 1 (dates 64 bits). */
function readMvhd(buffer: Buffer, offset: number, end: number): string | null {
  if (offset + 4 > end) return null;
  const version = buffer[offset]!;

  let seconds: number;
  if (version === 0) {
    if (offset + 8 > end) return null;
    seconds = buffer.readUInt32BE(offset + 4);
  } else if (version === 1) {
    if (offset + 12 > end) return null;
    const wide = buffer.readBigUInt64BE(offset + 4);
    if (wide > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    seconds = Number(wide);
  } else {
    return null;
  }

  // Zéro est la valeur d'un champ jamais renseigné, pas le 1er janvier 1904.
  if (seconds === 0) return null;

  const date = new Date((seconds - EPOCH_1904_OFFSET_S) * 1000);
  if (Number.isNaN(date.getTime())) return null;

  const year = date.getUTCFullYear();
  if (year < MIN_YEAR || year > MAX_YEAR) return null;

  return date.toISOString();
}
