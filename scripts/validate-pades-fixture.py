"""Independent offline acceptance check. Requires pyHanko==0.31.0.

Run the pdf-ltv-flow Jest fixture with SIGNA_AUDIT_OUTPUT_DIR first.
These are explicit private test roots, never production trust configuration.
"""
import argparse
import asyncio
from pathlib import Path

from pyhanko.keys import load_certs_from_pemder
from pyhanko.pdf_utils.reader import PdfFileReader
from pyhanko.sign.validation import (
    RevocationInfoValidationType,
    async_validate_pdf_ltv_signature,
)
from pyhanko.sign.validation.dss import DocumentSecurityStore
from pyhanko.sign.validation.settings import KeyUsageConstraints


async def validate(directory: Path):
    with (directory / "signed.pdf").open("rb") as stream:
        reader = PdfFileReader(stream, strict=True)
        context = {
            "trust_roots": list(load_certs_from_pemder([str(directory / "roots.pem")])),
            "allow_fetching": False,
        }
        bootstrap = DocumentSecurityStore.read_dss(reader).as_validation_context(context)
        assert len(reader.embedded_signatures) == 1
        result = await async_validate_pdf_ltv_signature(
            reader.embedded_signatures[0],
            RevocationInfoValidationType.PADES_LT,
            validation_context_kwargs=context,
            bootstrap_validation_context=bootstrap,
            key_usage_settings=KeyUsageConstraints(key_usage={"digital_signature"}),
        )
        print(result.pretty_print_details())
        assert result.bottom_line, "Independent PAdES-LT validation failed"


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("fixture_directory", type=Path)
    asyncio.run(validate(parser.parse_args().fixture_directory))
