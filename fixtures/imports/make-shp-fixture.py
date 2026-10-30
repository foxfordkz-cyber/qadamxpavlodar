"""Rebuild the synthetic binary SHP fixture with PyShp 3.1.6 (test authoring only)."""
from pathlib import Path
from io import BytesIO
import json
import struct
import sys
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED

if len(sys.argv) > 1:
    sys.path.insert(0, sys.argv[1])
import shapefile

root = Path(__file__).resolve().parent
# Invented test polygons within the prototype's coordinate bounds. Not municipal data.
rows = [
    {"name": "Демо SHP A", "ring": [[76.952, 52.281], [76.952, 52.282], [76.954, 52.282], [76.954, 52.281], [76.952, 52.281]]},
    {"name": "Демо SHP Ә", "ring": [[76.956, 52.281], [76.956, 52.282], [76.958, 52.282], [76.958, 52.281], [76.956, 52.281]]},
]
shp, shx, dbf = BytesIO(), BytesIO(), BytesIO()
with shapefile.Writer(shp=shp, shx=shx, dbf=dbf, shapeType=shapefile.POLYGON, encoding="utf-8") as writer:
    writer.field("name", "C", size=80)
    for row in rows:
        writer.poly([row["ring"]])
        writer.record(row["name"])
dbf_bytes = bytearray(dbf.getvalue())
dbf_bytes[1:4] = bytes([126, 10, 30])  # Fixed fixture date, 2026-10-30.
assert struct.unpack(">i", shp.getvalue()[:4])[0] == 9994
prj = 'GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433],AUTHORITY["EPSG","4326"]]'
parts = {"zones.shp": shp.getvalue(), "zones.shx": shx.getvalue(), "zones.dbf": bytes(dbf_bytes), "zones.prj": prj.encode(), "zones.cpg": b"UTF-8"}
with ZipFile(root / "synthetic-zones.zip", "w") as archive:
    for name, content in sorted(parts.items()):
        entry = ZipInfo(name, date_time=(2026, 10, 30, 0, 0, 0))
        entry.compress_type = ZIP_DEFLATED
        archive.writestr(entry, content)
(root / "synthetic-zones.expected.json").write_text(json.dumps(rows, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(f"Wrote synthetic-zones.zip: {len(rows)} polygons, EPSG:4326, PyShp {shapefile.__version__}")
