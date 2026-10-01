"""Pack Studio's build for dtk-studio: ``studio-dist.zip`` + ``.sha256``.

    python scripts/pack-studio-dist.py [DIST_DIR] [OUT_DIR]   # default: dist .

``index.html`` sits at the zip's root. The ``.sha256`` reads like
``sha256sum`` output. Stdlib only: runs with any Python 3.8+ (CI runners).
"""

import hashlib
import sys
import zipfile
from pathlib import Path


def main() -> None:
    dist = Path(sys.argv[1] if len(sys.argv) > 1 else "dist")
    out = Path(sys.argv[2] if len(sys.argv) > 2 else ".")
    if not (dist / "index.html").is_file():
        sys.exit(f"{dist}/index.html not found: run `npm run build` first.")
    out.mkdir(parents=True, exist_ok=True)
    zip_path = out / "studio-dist.zip"
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for path in sorted(p for p in dist.rglob("*") if p.is_file()):
            zf.write(path, path.relative_to(dist).as_posix())
    sha = hashlib.sha256(zip_path.read_bytes()).hexdigest()
    (out / "studio-dist.zip.sha256").write_text(f"{sha}  studio-dist.zip\n")
    print(f"{zip_path} {sha}")


if __name__ == "__main__":
    main()
