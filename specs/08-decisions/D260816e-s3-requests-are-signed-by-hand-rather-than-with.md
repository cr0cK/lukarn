# D260816e — S3 requests are signed by hand rather than with the AWS SDK

**Confidence.** observed — storage/sigv4.ts, git ls-files → exit 0 · 2026-08-23

**Context.** An S3-compatible bucket is the third storage this application reads,
behind the interface
[D260815f](./D260815f-a-storage-interface-and-drive-as-its-first.md) declared.
Every request to one must carry an AWS Signature Version 4 header, and the
obvious way to obtain one is `@aws-sdk/client-s3`.

Three things argue against it, and the exchange rate is what decides.

- **What is actually needed is three request shapes.** A `ListObjectsV2`, a
  ranged `GET`, and a listing bounded to one key for the Test button. That is the
  whole surface, and it will not grow: the interface has no write operation, and
  no backend but Drive holds a preview to ask for.
- **The SDK weighs some 15 MB** across dozens of transitive packages, in an image
  whose whole point is to run on a modest VPS. This is the arithmetic of
  [D5](./D5-googleapis-drive-rather-than-googleapis.md), which rejected the same
  bargain for Drive and for the same ratio.
- **Its streaming body does not map onto what the media proxy relays.** A ranged
  read is handed to the browser as the `Response` it arrived in — status, headers
  and body untouched — which is what makes seeking in a video work without
  transcoding. The SDK returns a parsed command output holding a Node stream, so
  every one of those responses would have to be taken apart and rebuilt.

**Decision.** `storage/sigv4.ts` computes the signature: about a hundred and
eighty lines over `node:crypto`, taking a request description and credentials and
returning headers. It opens no socket and holds no state, so it is a pure
function of its arguments.

The listings it signs are read by `storage/xml.ts`, already shared with WebDAV.
Between the two, the S3 backend adds **no dependency at all**.

**What makes this safe to have written by hand.** The published AWS test vectors,
in `packages/server/test/sigv4.test.ts`. Four of the `aws-sig-v4-test-suite`
cases run against the signer — `get-vanilla`,
`get-vanilla-query-order-key-case`, `get-header-value-trim` and `get-unreserved` —
and each asserts the canonical request, the string to sign and the
`Authorization` header separately.

That separation is the point. A bucket answers every signing mistake with the
same `SignatureDoesNotMatch`, and the mistake is almost always in the canonical
request: parameters sorted by locale instead of by byte, a header value whose
inner spaces were not collapsed, a path normalised by a signer trying to be
helpful. Comparing the intermediate strings says **which line** is wrong, where
comparing signatures says only that one is.

**The accepted costs.**

- **Duplicate header names are joined in arrival order and nothing here can
  produce one**, since the signer takes a `Record<string, string>`. The vectors
  cover the case; this implementation cannot reach it.
- **Quoted header values have their inner spaces collapsed**, which the
  specification exempts. The vector `get-header-value-trim` expects exactly that,
  and nothing signed here carries a quoted value anyway.
- **Presigned URLs are not implemented.** Nothing needs one: the media proxy
  reads the bytes itself rather than redirecting a browser at the bucket, which
  is what keeps album permissions in front of every object.
- **Paths are deliberately not normalised.** S3 is the service whose canonical
  URI is the literal path, because an object key may itself contain `..` or an
  empty segment — a signer that tidied it would sign a different object from the
  one being fetched.

**Rejected alternative: `aws4`, the small signing package.** It is a single file
with no dependencies and would have done. It also expects a Node-shaped request
options object, computes the date itself — which is what makes a signature
impossible to reproduce in a test — and would still have to be kept in step with
this application's own `fetch`. The vectors are what buys confidence here, and
they are equally available to code that can be read in one sitting.

**Not verified against a real bucket.** No environment this was written in had
one. The stub in `packages/server/test/s3.test.ts` recomputes the signature from
the request as it arrived, so a `Range` added after signing is refused there as
MinIO would refuse it — but a real MinIO, and a real ranged read of a large
video, remain to be done.
