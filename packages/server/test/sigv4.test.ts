import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { signRequest, type SigningCredentials } from '../src/storage/sigv4.js';

/**
 * The hand-written signature, against the vectors AWS publishes for it.
 *
 * These are not invented cases: each one below is a directory of the
 * `aws-sig-v4-test-suite`, and the three strings asserted are its `.creq`, `.sts` and
 * `.authz` files verbatim. They matter because the canonical request is the part a
 * signer gets wrong, and a bucket answers every one of those mistakes with the same
 * `SignatureDoesNotMatch` — the vectors are the only cheap way to learn *which* line
 * is wrong.
 *
 * The suite's own parameters: the key pair below, region `us-east-1`, service
 * `service`, signed at `20150830T123600Z`.
 */

const CREDENTIALS: SigningCredentials = {
  accessKeyId: 'AKIDEXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
};

const SCOPE = {
  region: 'us-east-1',
  service: 'service',
  signedAt: new Date('2015-08-30T12:36:00Z'),
};

const EMPTY_BODY = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

const CREDENTIAL_SCOPE = 'AKIDEXAMPLE/20150830/us-east-1/service/aws4_request';

/** The `.sts` of every case here, given the hash of its canonical request. */
function stringToSign(canonicalHash: string): string {
  return [
    'AWS4-HMAC-SHA256',
    '20150830T123600Z',
    '20150830/us-east-1/service/aws4_request',
    canonicalHash,
  ].join('\n');
}

describe('the published SigV4 vectors', () => {
  it('get-vanilla', async () => {
    const signed = signRequest(
      { method: 'GET', url: new URL('https://example.amazonaws.com/') },
      CREDENTIALS,
      SCOPE,
    );

    assert.equal(
      signed.canonicalRequest,
      [
        'GET',
        '/',
        '',
        'host:example.amazonaws.com',
        'x-amz-date:20150830T123600Z',
        '',
        'host;x-amz-date',
        EMPTY_BODY,
      ].join('\n'),
    );
    assert.equal(
      signed.stringToSign,
      stringToSign('bb579772317eb040ac9ed261061d46c1f17a8133879d6129b6e1c25292927e63'),
    );
    assert.equal(
      signed.headers.authorization,
      `AWS4-HMAC-SHA256 Credential=${CREDENTIAL_SCOPE}, SignedHeaders=host;x-amz-date, ` +
        'Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31',
    );
  });

  it('get-vanilla-query-order-key-case — parameters sort by byte, not by arrival', async () => {
    const signed = signRequest(
      { method: 'GET', url: new URL('https://example.amazonaws.com/?Param2=value2&Param1=value1') },
      CREDENTIALS,
      SCOPE,
    );

    assert.equal(
      signed.canonicalRequest,
      [
        'GET',
        '/',
        'Param1=value1&Param2=value2',
        'host:example.amazonaws.com',
        'x-amz-date:20150830T123600Z',
        '',
        'host;x-amz-date',
        EMPTY_BODY,
      ].join('\n'),
    );
    assert.equal(
      signed.stringToSign,
      stringToSign('816cd5b414d056048ba4f7c5386d6e0533120fb1fcfa93762cf0fc39e2cf19e0'),
    );
    assert.equal(
      signed.signature,
      'b97d918cfa904a5beff61c982a1b6f458b799221646efd99d3219ec94cdf2500',
    );
  });

  it('get-header-value-trim — headers sort, and their whitespace collapses', async () => {
    // Deliberately supplied out of order and in mixed case: a signer that signed them
    // as given would produce a different `SignedHeaders` and be refused.
    const signed = signRequest(
      {
        method: 'GET',
        url: new URL('https://example.amazonaws.com/'),
        headers: { 'My-Header2': ' "a   b   c" ', 'My-Header1': ' value1 ' },
      },
      CREDENTIALS,
      SCOPE,
    );

    assert.equal(
      signed.canonicalRequest,
      [
        'GET',
        '/',
        '',
        'host:example.amazonaws.com',
        'my-header1:value1',
        // Runs of spaces collapse even inside the quotes — the vector is explicit,
        // and the exemption the specification writes for quoted values is not one
        // any signer that passes this test implements.
        'my-header2:"a b c"',
        'x-amz-date:20150830T123600Z',
        '',
        'host;my-header1;my-header2;x-amz-date',
        EMPTY_BODY,
      ].join('\n'),
    );
    assert.equal(
      signed.stringToSign,
      stringToSign('a726db9b0df21c14f559d0a978e563112acb1b9e05476f0a6a1c7d68f28605c7'),
    );
    assert.equal(
      signed.headers.authorization,
      `AWS4-HMAC-SHA256 Credential=${CREDENTIAL_SCOPE}, ` +
        'SignedHeaders=host;my-header1;my-header2;x-amz-date, ' +
        'Signature=acc3ed3afb60bb290fc8d2dd0098b9911fcaa05412b367055dee359757a9c736',
    );
  });

  it('get-unreserved — the unreserved characters survive encoding untouched', async () => {
    const path = '/-._~0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
    const signed = signRequest(
      { method: 'GET', url: new URL(`https://example.amazonaws.com${path}`) },
      CREDENTIALS,
      SCOPE,
    );

    assert.equal(
      signed.canonicalRequest,
      [
        'GET',
        path,
        '',
        'host:example.amazonaws.com',
        'x-amz-date:20150830T123600Z',
        '',
        'host;x-amz-date',
        EMPTY_BODY,
      ].join('\n'),
    );
    assert.equal(
      signed.signature,
      '07ef7494c76fa4850883e2b006601f940f8a34d404d0cfa977f52a65bbf5f24f',
    );
  });
});

describe('what this application signs that the vectors do not', () => {
  it('covers the Range header, which is what a video seek depends on', async () => {
    const signed = signRequest(
      {
        method: 'GET',
        url: new URL('https://photos.example.com/2026/soiree.mp4'),
        headers: { Range: 'bytes=1048576-2097151' },
      },
      CREDENTIALS,
      { region: 'eu-west-3', service: 's3', signedAt: new Date('2026-08-16T09:00:00Z') },
    );

    // Present in the canonical request **and** announced in `SignedHeaders`: a bucket
    // verifies every header named there, so one missing from either list is a range
    // the server is free to ignore — or to refuse outright.
    assert.match(signed.canonicalRequest, /\nrange:bytes=1048576-2097151\n/);
    assert.match(signed.canonicalRequest, /\nhost;range;x-amz-date\n/);
    assert.match(signed.headers.authorization!, /SignedHeaders=host;range;x-amz-date,/);
    assert.equal(signed.headers.range, 'bytes=1048576-2097151');
  });

  it('signs a key whose name needs encoding, without normalising the path', async () => {
    const signed = signRequest(
      // `+` and a space are the two an encoder gets wrong in opposite directions, and
      // `..` is the segment a tidying signer would remove — leaving a signature for an
      // object other than the one requested.
      { method: 'GET', url: new URL('https://photos.example.com/a%20b/..%2Bc/plage.jpg') },
      CREDENTIALS,
      { region: 'eu-west-3', service: 's3', signedAt: new Date('2026-08-16T09:00:00Z') },
    );

    assert.equal(signed.canonicalRequest.split('\n')[1], '/a%20b/..%2Bc/plage.jpg');
  });

  it('scopes the signature to the day it was signed', async () => {
    const request = { method: 'GET', url: new URL('https://photos.example.com/') };
    const scope = { region: 'eu-west-3', service: 's3' };

    const before = signRequest(request, CREDENTIALS, {
      ...scope,
      signedAt: new Date('2026-08-16T23:59:59Z'),
    });
    const after = signRequest(request, CREDENTIALS, {
      ...scope,
      signedAt: new Date('2026-08-17T00:00:01Z'),
    });

    assert.match(before.headers.authorization!, /Credential=AKIDEXAMPLE\/20260816\//);
    assert.match(after.headers.authorization!, /Credential=AKIDEXAMPLE\/20260817\//);
    assert.notEqual(before.signature, after.signature);
  });
});
