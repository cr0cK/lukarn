import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formatUserCode, normalizeUserCode } from '@nonni/shared';
import { qrCode } from '../src/lib/qr';

/**
 * The QR code displayed on a screen without a keyboard (D260809c).
 *
 * This verifies what rendering would not reveal: the path describes the
 * generated grid correctly, and the code can be copied by hand without its
 * readable form changing what is sent to the server.
 */

describe('QR path', () => {
  it('returns a square grid and a non-empty path', () => {
    const qr = qrCode('https://photos.exemple.fr/pair?code=ABCD2345');

    // QR versions are 21, 25, 29… modules wide: always 4n + 17.
    assert.equal((qr.size - 17) % 4, 0);
    assert.ok(qr.path.length > 0);
  });

  it('places the finder pattern at the top left', () => {
    const qr = qrCode('https://photos.exemple.fr/pair?code=ABCD2345');

    // The three finder patterns are invariant: the top-left corner starts with
    // seven consecutive black modules, which must appear as one rectangle —
    // exactly what run merging produces.
    assert.match(qr.path, /^M0 0h7v1h-7z/);
  });

  it('grows with the encoded text', () => {
    const court = qrCode('https://a.fr/pair?code=ABCD2345');
    const long = qrCode(`https://${'sous-domaine.'.repeat(8)}exemple.fr/pair?code=ABCD2345`);

    // The version is selected automatically because a fixed size would break
    // on the first slightly long domain name.
    assert.ok(long.size > court.size);
  });
});

describe('displayed code', () => {
  it('can be copied with its hyphen and in lowercase', () => {
    // The code is displayed in groups of four so it can be read from a distance;
    // the folded form is sent to the server, otherwise a copied code would
    // identify nothing.
    assert.equal(normalizeUserCode('abcd-2345'), 'ABCD2345');
    assert.equal(normalizeUserCode('ABCD 2345'), 'ABCD2345');
    assert.equal(formatUserCode('ABCD2345'), 'ABCD-2345');
    assert.equal(normalizeUserCode(formatUserCode('ABCD2345')), 'ABCD2345');
  });
});
