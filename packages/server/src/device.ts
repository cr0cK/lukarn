import type { DeviceKind } from '@nonni/shared';

/**
 * Classe d'appareil déduite du user-agent, à la création de la session.
 *
 * Le user-agent lui-même n'est **jamais** stocké : c'est une empreinte, souvent
 * unique à une version de navigateur près. Une classe parmi quatre ne
 * ré-identifie personne et répond à la seule question posée — « depuis quoi
 * regarde-t-on cette galerie ? », dont dépend ce qu'on optimise (D260809h).
 *
 * `null` quand la requête n'a pas d'en-tête : une valeur inventée serait
 * indiscernable d'une mesure.
 */
export function classifyDevice(userAgent: string | undefined): DeviceKind | null {
  if (!userAgent) return null;

  // L'ordre décide de tout, et le téléviseur passe en premier : un webOS
  // annonce « Mobile » **et** « Safari » dans son user-agent, et un test naïf le
  // classerait téléphone. C'est le cas qui a motivé la mesure — le salon est
  // précisément l'écran qu'on ne voit pas dans les journaux.
  if (/webOS|Web0S|Tizen|SmartTV|SMART-TV|BRAVIA|AppleTV|CrKey|HbbTV/i.test(userAgent)) {
    return 'tv';
  }

  // `Android` sans `Mobi` est la signature d'une tablette Android : Chrome
  // n'écrit « Mobile » que sur un téléphone. Sans cette règle, toutes les
  // tablettes Android compteraient comme des téléphones, et la colonne ne
  // distinguerait plus ce qu'elle prétend distinguer.
  if (/iPad|Tablet|PlayBook|Silk/i.test(userAgent)) return 'tablette';
  if (/Android/i.test(userAgent) && !/Mobi/i.test(userAgent)) return 'tablette';

  if (/Mobi|Android|iPhone|iPod/i.test(userAgent)) return 'mobile';

  // Un iPad récent se déclare « Macintosh » et tombe donc ici : Apple l'a voulu
  // ainsi pour obtenir les sites de bureau, et rien dans l'en-tête ne permet de
  // le rattraper. Le biais est connu et assumé — le corriger demanderait de
  // sonder le tactile en JavaScript, c'est-à-dire un traceur.
  return 'ordinateur';
}
