"""Read an unchanged external SHP with independent PyShp; never rewrite the archive.

Run with PyShp 3.1.6 installed. The importer itself uses shpjs, not this reader.
"""
import hashlib
import io
import json
from pathlib import Path
import zipfile

import shapefile

root = Path(__file__).resolve().parent
for stem, sha in {
    "ne_110m_lakes": "f2eed3c738a93010770acb0ba44273ea6a83b053641588bc902d9d6fd1cdafcb",
    "ne_110m_geography_regions_elevation_points": "5f1952dc9b8b947fe492778282a67c7ecd84c66052977f1400f3e6b817f30b61",
}.items():
    archive = root / (stem + ".zip")
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    assert digest == sha
    with zipfile.ZipFile(archive) as z:
        reader = shapefile.Reader(
            shp=io.BytesIO(z.read(stem + ".shp")),
            shx=io.BytesIO(z.read(stem + ".shx")),
            dbf=io.BytesIO(z.read(stem + ".dbf")), encoding="utf-8",
        )
        features = []
        for x in reader.iterShapeRecords():
            props = x.record.as_dict()
            points = x.shape.points
            features.append({"name": props["name"], "neId": props["ne_id"],
                "bbox": [min(p[0] for p in points), min(p[1] for p in points),
                         max(p[0] for p in points), max(p[1] for p in points)],
                "vertices": len(points),
                "consecutiveDuplicate": any(a == b for a, b in zip(points, points[1:]))})
        expected = {"archiveSha256": digest,
            "version": z.read(stem + ".VERSION.txt").decode().strip(),
            "crs": z.read(stem + ".prj").decode(), "features": features}
        (root / (stem + ".expected.json")).write_text(
            json.dumps(expected, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Read {len(features)} features; archive unchanged ({digest})")
