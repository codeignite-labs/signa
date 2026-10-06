# Signing architecture and rollout

Reviewed 2026-10-06. This supersedes earlier progress notes that inferred PAdES/LTV compliance from a subfilter or DSS dictionary alone.

## Production decision

For an organization signing customer documents, procure an **organization document-signing/e-seal credential**, issued for the intended use by a provider on the applicable recipient trust list. Prefer a non-exportable HSM key with a remote signing API, a contracted RFC 3161 timestamp service, revocation services, rotation procedures, and throughput/SLA suitable for the measured peak workload. Adobe's AATL is relevant for default Acrobat trust; an ordinary publicly trusted TLS certificate is not a substitute. An organization's seal does not prove that each customer controlled a personal signing key. Keep customer authentication, consent and audit evidence.

The implemented upload path accepts an RSA P12/PFX private key, end-entity signing certificate and complete chain (including root). It rejects CA keys, mismatches, expired chains, weak RSA keys and SHA-1/MD5 certificate signatures. Public CA certificates are uploaded separately as trust anchors. A CA upload cannot supply a signing private key or make a private CA publicly trusted.

**Remote HSM signing is not connected yet.** `PdfSigningIdentity.sign` is the adapter boundary, currently implemented by the local P12 adapter. Its contract is SHA-256/RSA PKCS#1 v1.5 over the supplied DER signed attributes. A selected provider's key provisioning, authenticated API, quotas, idempotency and outage behavior must be integrated and acceptance-tested before claiming HSM-backed production operation. Do not export an HSM credential to satisfy the P12 interface.

## DocuSeal reference and deliberate differences

Reference: local DocuSeal commit `da44d51a3bcd11005d3158cff8cece26e722bd4d`, locked HexaPDF `1.7.0`. See `../docuseal/lib/submissions/generate_result_attachments.rb` and `../docuseal/lib/generate_certificate.rb`, plus signing certificate settings/controllers. The result-attachment LTV hook is a no-op in this pinned self-hosted tree. HexaPDF's nested timestamp handler timestamps the CMS signature value. Its response handling and fallback are not a sufficient validation policy for our deployment. The generated private CA is a shared limitation, not public trust supplied by DocuSeal.

Signa had changed `SubFilter` to `ETSI.CAdES.detached` while retaining a generic PKCS#7 signer without the ESS certificate reference; added a disconnected document timestamp; accepted roots by familiar common name; and collected leaf-only revocation data. Those were not equivalent to a validated PAdES-LT pipeline.

Intentional improvements:

- CMS signed attributes bind the PDF ByteRange digest and signer certificate (`signingCertificateV2`); no CMS `signingTime` attribute. A validated CMS signature timestamp binds the signature value.
- RFC 3161 responses must match the nonce and imprint. Signature, ESS reference, timestamp time, exclusive critical TSA EKU and configured trust chain are checked. There is no local-time fallback.
- DSS contains the signer, intermediate and TSA chains and revocation evidence for non-root certificates. Revocation signatures, issuer identity and freshness are checked; cached bytes are revalidated. Private/reserved network endpoints, redirects and oversized responses are rejected.
- Uploaded identities have unique names, encrypted private material and explicit activation. Account-row locking and the existing unique configuration key serialize mutations across PostgreSQL workers. Upload never replaces an identity; active deletion is refused. An invalid selection stops signing.
- Trust comes from explicit anchors, never `Signa Root CA` text. The API reports CMS timestamp validation separately from the legacy document-timestamp flag. The UI names the subfilter without presenting it as proof of compliance.

## Deploy and upgrade

1. Back up the database and protect the backup: previous signing records contained plaintext key material despite the table name `encrypted_configs`.
2. Provision `SIGNING_KEY_ENCRYPTION_KEY` as a stable secret shared by API and workers: 32 random bytes, 64 hex characters (`openssl rand -hex 32`). Keep it outside the database, source tree and logs. Losing or replacing it without rewrapping records makes existing identities unusable.
3. With that secret and database configuration loaded, run from `apps/backend`: `pnpm exec ts-node src/pdf-signatures/encrypt-legacy-signing-keys.cli.ts`. This batches all signing records, encrypts plaintext with AES-256-GCM bound to the account, authenticates already encrypted records, and uses conditional updates to avoid overwriting concurrent changes. It makes no schema changes and can be rerun. This command was added but was **not run against a deployment database**. Old backups still require separate protection/retention handling.
4. Upload the organization's approved public CA trust anchor and named signing identity, then activate the identity. New uploads are inactive. An in-flight signing job uses the identity it loaded; subsequent jobs resolve the new selection. Completed artifacts and their certificate fingerprints stay unchanged.
5. Configure `PDF_TSA_TRUST_CERTIFICATES` with the approved TSA PEM roots (literal `\n` accepted), then save the account's timestamp URL. Saving performs a real timestamp verification. Optional comma-separated fallbacks must all belong to approved services.
6. Set `PDF_SIGNATURE_SUBFILTER=pades`, `PDF_REQUIRE_TRUSTED_SIGNER=true`, `PDF_TIMESTAMP_REQUIRED=true`, `PDF_LTV_REQUIRED=true`. The three boolean policies default to true under `NODE_ENV=production`; explicitly copied `false` values override those defaults. Required timestamp/evidence failures prevent delivery of a successful signed result. Approval of uploaded roots is an operator policy decision, not an automated AATL/EUTL-membership assertion.
7. Exercise the actual provider-issued chain and TSA in staging, including unavailable/revoked/expired credentials, rotation and independent PDF verification. Use PostgreSQL and the existing queue workers; measure signatures/second, peak concurrent jobs, PDF sizes/pages, TSA/OCSP/CRL latency and outage recovery. No 100K-customer capacity claim or load test is made by this change.

No schema migration is required. Existing generated keys are retained, never silently replaced. Older generated CAs lacking `cRLSign` or a complete revocation path may fail strict LTV; migrate to a named provider-issued identity. The generated private CA remains useful for explicit private-trust/test deployments. Its empty internal CRLs are not a managed public revocation service and do not establish a production CA program.

## Validation and limits

The regression fixture uses a real OpenSSL TSA and locally generated test certificates, with network transport mocked. CMS verification is exercised with PKI.js and OpenSSL. `scripts/validate-pades-fixture.py` independently checks the emitted PDF using pyHanko 0.31.0 in strict parsing mode, offline, with explicit fixture trust roots and digital-signature key usage. It validates PAdES-LT, timestamp trust and post-signature DSS changes. The fixture is not a public-trust or legal compliance certificate.

Validation performed: 53 focused regression tests passed, followed by 3 new signed-OCSP tests and a repeat of the 2 verifier tests after extraction. Backend/frontend type checks and touched-file lint passed. A Chrome smoke test with synthetic API responses checked named/password-protected upload, unchanged selection after upload and explicit activation, with no browser errors. The pyHanko check reported VALID. PostgreSQL multi-worker contention, a deployment database migration, provider-issued credentials and production throughput were not exercised.

Reproduce:

```sh
SIGNA_AUDIT_OUTPUT_DIR=/tmp/signa-pades-fixture pnpm --filter backend test --runInBand pdf-ltv-flow.spec
python3 -m venv /tmp/signa-validator
/tmp/signa-validator/bin/pip install 'pyHanko==0.31.0'
/tmp/signa-validator/bin/python scripts/validate-pades-fixture.py /tmp/signa-pades-fixture
```

The upload adapter currently supports RSA, not EC/PSS private keys. TSA validation supports RSA PKCS#1 and ECDSA SHA-256/384/512, with SHA-256 message imprints and issuer/serial signer identifiers. Delta/partitioned CRLs and delegated OCSP responders lacking `id-pkix-ocsp-nocheck` are not accepted as sufficient evidence; a supported CRL path is required instead. No archive timestamp renewal (PAdES-B-LTA), qualified-signature certification, automated public trust-list synchronization, HSM provider integration, or jurisdiction-specific legal assurance is claimed. The built-in verifier's PDF detection/DSS reader remains scoped to our emitted structure; use independent validators for arbitrary third-party PDFs and certification.

## Official references

- [ETSI EN 319 142-1 V1.2.1](https://www.etsi.org/deliver/etsi_en/319100_319199/31914201/01.02.01_60/en_31914201v010201p.pdf), clauses 5 and 6: PAdES attributes and baseline levels. B-B is the basic signature; B-T adds trusted time; B-LT adds validation material; B-LTA adds archival timestamp protection. PAdES conformance and public trust are separate questions.
- [RFC 3161](https://www.rfc-editor.org/rfc/rfc3161.html), sections 2.3/2.4: TSA certificate purpose and response verification.
- [RFC 5280](https://www.rfc-editor.org/rfc/rfc5280.html), sections 4–6: certificate constraints, CRLs and path validation.
- [RFC 6960](https://www.rfc-editor.org/rfc/rfc6960.html), sections 4.2.2.2/4.2.2.4: authorized responders and time/freshness checks.
- [Adobe AATL](https://www.adobe.com/security/approved-trust-list.html): document-signing trust in Acrobat.
- [DigiCert document-signing HSM requirements](https://knowledge.digicert.com/general-information/hsm-letter-procedure-authentication): provider-specific key protection requirements, to confirm with the chosen credential product.
