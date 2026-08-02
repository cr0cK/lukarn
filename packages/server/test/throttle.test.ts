import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { LoginThrottle } from '../src/throttle.js';

/**
 * Limitation des tentatives de connexion. Chaque tentative refusée coûte une
 * vérification argon2, volontairement lente : ce qui n'est pas freiné ici se
 * paie en CPU sur le VPS.
 */

const now = 1_700_000_000_000;

const depuis = (ip: string, username: string): { ip: string; username: string } => ({
  ip,
  username,
});

describe('throttle de connexion', () => {
  it('laisse passer les premières erreurs de frappe', () => {
    const throttle = new LoginThrottle();
    const moi = depuis('10.0.0.1', 'alexis');

    for (let essai = 0; essai < 5; essai++) {
      assert.equal(throttle.blockedFor(moi, now), 0);
      throttle.fail(moi, now);
    }
    assert.equal(throttle.blockedFor(moi, now), 0);

    throttle.fail(moi, now);
    assert.ok(throttle.blockedFor(moi, now) > 0);
  });

  it('double le délai à chaque échec supplémentaire', () => {
    const throttle = new LoginThrottle();
    const moi = depuis('10.0.0.1', 'alexis');

    for (let essai = 0; essai < 6; essai++) throttle.fail(moi, now);
    const premier = throttle.blockedFor(moi, now);

    throttle.fail(moi, now);
    assert.equal(throttle.blockedFor(moi, now), premier * 2);
  });

  it('oublie une série ancienne', () => {
    const throttle = new LoginThrottle();
    const moi = depuis('10.0.0.1', 'alexis');
    for (let essai = 0; essai < 8; essai++) throttle.fail(moi, now);

    assert.equal(throttle.blockedFor(moi, now + 2 * 60 * 60 * 1000), 0);
  });

  it('laisse tranquille un autre visiteur sur un autre compte', () => {
    const throttle = new LoginThrottle();
    for (let essai = 0; essai < 8; essai++) throttle.fail(depuis('10.0.0.1', 'alexis'), now);

    assert.equal(throttle.blockedFor(depuis('10.0.0.2', 'famille'), now), 0);
  });

  it('freine une adresse qui essaie des identifiants au hasard', () => {
    const throttle = new LoginThrottle();

    // Chaque tentative porte un identifiant inédit : aucun compteur de couple
    // ne dépasse une tentative. Sans plafond par adresse, l'attaquant obtient
    // autant de vérifications argon2 qu'il en demande.
    for (let essai = 0; essai < 40; essai++) {
      throttle.fail(depuis('10.0.0.66', `inconnu-${essai}`), now);
    }

    assert.ok(
      throttle.blockedFor(depuis('10.0.0.66', 'encore-un-autre'), now) > 0,
      "l'adresse doit être freinée quel que soit l'identifiant présenté",
    );
    // Un visiteur venu d'ailleurs ne paie pas pour elle.
    assert.equal(throttle.blockedFor(depuis('10.0.0.7', 'alexis'), now), 0);
  });

  it('freine une attaque distribuée sur un seul compte', () => {
    const throttle = new LoginThrottle();

    // Une adresse différente à chaque essai : ni le couple ni l'adresse ne
    // voient quoi que ce soit, seul le compte visé accumule.
    for (let essai = 0; essai < 20; essai++) {
      throttle.fail(depuis(`203.0.113.${essai}`, 'alexis'), now);
    }

    assert.ok(throttle.blockedFor(depuis('198.51.100.9', 'alexis'), now) > 0);
    assert.equal(throttle.blockedFor(depuis('198.51.100.9', 'famille'), now), 0);
  });

  it('applique le plus contraignant des trois axes', () => {
    const throttle = new LoginThrottle();
    const moi = depuis('10.0.0.1', 'alexis');

    // Six échecs sur le couple : pénalité déjà active alors que les compteurs
    // par identifiant (10 essais libres) et par adresse (20) dorment encore.
    for (let essai = 0; essai < 6; essai++) throttle.fail(moi, now);

    assert.ok(throttle.blockedFor(moi, now) > 0);
  });

  it('libère le visiteur légitime après une connexion réussie', () => {
    const throttle = new LoginThrottle();
    const moi = depuis('10.0.0.1', 'alexis');
    for (let essai = 0; essai < 8; essai++) throttle.fail(moi, now);
    assert.ok(throttle.blockedFor(moi, now) > 0);

    throttle.succeed(moi);
    assert.equal(throttle.blockedFor(moi, now), 0);
  });

  it("ne laisse pas un compte valide effacer l'ardoise de son adresse", () => {
    const throttle = new LoginThrottle();

    for (let essai = 0; essai < 40; essai++) {
      throttle.fail(depuis('10.0.0.66', `inconnu-${essai}`), now);
    }
    // L'attaquant possède un compte sur l'instance et s'y connecte pour
    // remettre les compteurs à zéro entre deux rafales.
    throttle.succeed(depuis('10.0.0.66', 'complice'));

    assert.ok(throttle.blockedFor(depuis('10.0.0.66', 'inconnu-suivant'), now) > 0);
  });

  it('oublie ses compteurs expirés quand on lui demande le ménage', () => {
    const throttle = new LoginThrottle();
    for (let essai = 0; essai < 500; essai++) {
      throttle.fail(depuis('10.0.0.66', `inconnu-${essai}`), now);
    }
    assert.ok(throttle.size > 500);

    const oublies = throttle.purge(now + 2 * 60 * 60 * 1000);

    assert.ok(oublies > 0);
    assert.equal(throttle.size, 0, 'aucune série ne doit survivre à son expiration');
  });

  it('borne sa table même sans ménage', () => {
    const throttle = new LoginThrottle();

    // Une rafale bien plus grosse que la borne, sur une heure glissante : la
    // purge horaire n'aurait rien à effacer, c'est la borne qui doit tenir.
    for (let essai = 0; essai < 40_000; essai++) {
      throttle.fail(depuis(`198.51.${essai % 256}.${essai % 251}`, `inconnu-${essai}`), now);
    }

    assert.ok(throttle.size <= 20_000, `table non bornée : ${throttle.size} entrées`);
  });
});
