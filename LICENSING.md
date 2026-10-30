# Licensing Signa

Copyright (c) 2026 Signa contributors. Each contributor retains copyright in
their contributions. Existing third-party copyrights remain with their owners.

## Scope

| Path                                                                             | License                                                |
| -------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Repository contents unless an exception below or a file-level notice applies     | [GNU AGPL version 3 only](./LICENSE) (`AGPL-3.0-only`) |
| `packages/signa-react`                                                           | [MIT](./packages/signa-react/LICENSE)                  |
| `packages/signa-react-native`                                                    | [MIT](./packages/signa-react-native/LICENSE)           |
| Third-party dependencies, copied assets and other material with existing notices | Their respective licenses; preserve those notices      |

The SDK licenses cover their wrappers and packaged browser scripts, not the
separately hosted platform. Copying platform code into an SDK does not convert
that code to MIT. File-level upstream obligations take precedence over a general
directory declaration. This setup retains the SDKs' existing MIT declarations;
it is not a claim that a complete dependency or copyright audit has been done.

## Using, modifying and hosting the platform

AGPL permits commercial use and charging for hosting or support. Distributions
must satisfy its license, notice and corresponding-source requirements. If you
modify the platform and let users interact with it remotely over a network,
section 13 requires a prominent opportunity for those users to obtain the
Corresponding Source of that version, at no charge.

Keep the source offer tied to the running revision, including modifications and
the build/install material required by the license. A link to an unmodified or
outdated public branch may not provide that source. A README or repository
license alone does not implement the in-product source offer.

The [full license](./LICENSE) governs. GNU provides
[AGPL guidance](https://www.gnu.org/licenses/why-affero-gpl.html) and a
[license FAQ](https://www.gnu.org/licenses/gpl-faq.html).

## DocuSeal and upstream attribution

Signa is a TypeScript implementation guided by DocuSeal's source, workflows and
API behavior. See [NOTICE](./NOTICE) and the preserved upstream
[additional terms](./LICENSE_ADDITIONAL_TERMS). Those terms require covered
works to retain original DocuSeal attribution in interactive user interfaces.
They apply to covered DocuSeal-derived material, not as a new restriction on
independently authored MIT SDK code.

Keep original copyright, license and attribution notices when importing or
translating upstream material. Record the source URL and commit in the change.
A language rewrite, renamed symbols or compatibility claim does not by itself
remove upstream obligations. Do not import proprietary or commercially licensed
DocuSeal features without the necessary permission.

White-label preferences do not authorize removing legally required notices or
source offers. The existing white-label UI needs a separate runtime review for
these requirements before treating a deployment as compliant. This PR's license
files do not certify application behavior or clear all historical provenance.

## Contributions and trademarks

Contributions use the license applicable to the changed files. Contributors must
have the right to submit their work and identify third-party material. No
copyright assignment, contributor license agreement or commercial relicensing
permission is introduced by this policy.

The software licenses do not grant trademark rights to Signa, CodeIgnite,
DocuSeal or their logos. Dependency licenses and notices continue to apply.
